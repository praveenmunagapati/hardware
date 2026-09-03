// ============================================================================
// app.js — MiniCPU 32-bit Application Layer
// ============================================================================
// Wires UI ↔ Compiler ↔ CPU ↔ Visualizer
// ============================================================================

'use strict';

(() => {
    // ════════════════════════════════════════════════════════════════════
    // Globals
    // ════════════════════════════════════════════════════════════════════
    const bus = new MiniCPU.EventBus();
    const cpu = new MiniCPU.CPU(bus);
    const compiler = new MiniCompiler.Compiler(bus);

    let compiledData = null;
    let isCompiled = false;

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // ════════════════════════════════════════════════════════════════════
    // Example Programs (C style with main/printf)
    // ════════════════════════════════════════════════════════════════════

    const EXAMPLES = {
        'Hello World': `#include <stdio.h>

int main() {
    printf("Hello, World!\\n");
    return 0;
}`,

        'Sum 1..10': `#include <stdio.h>

int main() {
    int sum = 0;
    for (int i = 1; i <= 10; i++) {
        sum += i;
    }
    printf("Sum = %d\\n", sum);
    return 0;
}`,

        'Fibonacci': `#include <stdio.h>

int main() {
    int a = 0;
    int b = 1;
    int temp = 0;
    for (int i = 0; i < 10; i++) {
        printf("%d ", a);
        temp = a + b;
        a = b;
        b = temp;
    }
    printf("\\n");
    return 0;
}`,

        'Factorial': `#include <stdio.h>

int main() {
    int n = 10;
    int fact = 1;
    for (int i = 1; i <= n; i++) {
        fact *= i;
    }
    printf("%d! = %d\\n", n, fact);
    return 0;
}`,

        'Max of Two': `#include <stdio.h>

int main() {
    int x = 42;
    int y = 17;
    int max = 0;
    if (x > y) {
        max = x;
    } else {
        max = y;
    }
    printf("max(%d, %d) = %d\\n", x, y, max);
    return 0;
}`,

        'Countdown': `#include <stdio.h>

int main() {
    for (int i = 10; i >= 0; i--) {
        printf("%d ", i);
    }
    printf("\\nLiftoff!\\n");
    return 0;
}`,

        'Multiplication': `#include <stdio.h>

int main() {
    int a = 7;
    int b = 6;
    int result = a * b;
    printf("%d x %d = %d\\n", a, b, result);
    return 0;
}`,

        'Division & Mod': `#include <stdio.h>

int main() {
    int a = 100;
    int b = 7;
    int quot = a / b;
    int rem = a % b;
    printf("%d / %d = %d remainder %d\\n", a, b, quot, rem);
    return 0;
}`,

        'Power of 2': `#include <stdio.h>

int main() {
    int result = 1;
    for (int i = 0; i < 16; i++) {
        printf("2^%d = %d\\n", i, result);
        result *= 2;
    }
    return 0;
}`,

        'Squares': `#include <stdio.h>

int main() {
    for (int i = 1; i <= 12; i++) {
        printf("%d^2 = %d\\n", i, i * i);
    }
    return 0;
}`,

        'Nested Loops': `#include <stdio.h>

int main() {
    int sum = 0;
    for (int i = 1; i <= 5; i++) {
        for (int j = 1; j <= i; j++) {
            sum += j;
        }
    }
    printf("Sum = %d\\n", sum);
    return 0;
}`,

        'Large Numbers': `#include <stdio.h>

int main() {
    int million = 1000000;
    int result = million * 42;
    printf("%d * 42 = %d\\n", million, result);
    
    int big = 2147483647;
    printf("Max int: %d\\n", big);
    return 0;
}`,

        'Macros & Constants': `#include <stdio.h>
#define MAX_ITEMS 5
#define MULTIPLIER 10

int main() {
    int total = 0;
    for (int i = 1; i <= MAX_ITEMS; i++) {
        int scaled = i * MULTIPLIER;
        total += scaled;
        printf("Item %d: value = %d\\n", i, scaled);
    }
    printf("Total sum = %d\\n", total);
    return 0;
}`,
    };

    // ════════════════════════════════════════════════════════════════════
    // DOM References
    // ════════════════════════════════════════════════════════════════════

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // Editor & Highlighting
    const editorArea         = $('#source-editor');
    const editorHighlight    = $('#editor-highlight');
    const highlightingContent= $('#highlighting-content');

    // Buttons
    const btnCompile = $('#btn-compile');
    const btnRun     = $('#btn-run');
    const btnStep    = $('#btn-step');
    const btnPause   = $('#btn-pause');
    const btnReset   = $('#btn-reset');
    const btnFast    = $('#btn-fast');

    // Speed
    const speedSlider = $('#speed-slider');
    const speedLabel  = $('#speed-value');

    // Panels
    const prepPanel     = $('#preprocessed-output');
    const tokenPanel    = $('#token-output');
    const astPanel      = $('#ast-output');
    const symbolPanel   = $('#symbol-output');
    const rawIRPanel    = $('#raw-ir-output');
    const optIRPanel    = $('#opt-ir-output');
    const asmPanel      = $('#asm-output');
    const bytecodePanel = $('#bytecode-output');
    const consolePanel  = $('#console-output');
    const tracePanel    = $('#trace-output');

    // CPU Display
    const regEls = {};
    for (let i = 0; i < 8; i++) {
        regEls[i] = $(`#reg-r${i}`);
    }
    const regPC   = $('#reg-pc');
    const regSP   = $('#reg-sp');
    const flagZ   = $('#flag-z');
    const flagN   = $('#flag-n');
    const flagC   = $('#flag-c');
    const flagV   = $('#flag-v');
    const cycleCount = $('#cycle-count');

    // Memory grid
    const memoryGrid = $('#memory-grid');

    // Status
    const statusBar  = $('#status-bar');
    const statusText = $('#status-text');
    const statusLed  = $('#status-led');

    // Example selector
    const exampleSelect = $('#example-select');

    // ════════════════════════════════════════════════════════════════════
    // Constants for memory display
    // ════════════════════════════════════════════════════════════════════
    const MEM_DISPLAY_ROWS = 32;  // Show first 512 bytes (32 rows × 16 cols)
    const MEM_DISPLAY_COLS = 16;
    const MEM_DISPLAY_SIZE = MEM_DISPLAY_ROWS * MEM_DISPLAY_COLS;

    // ════════════════════════════════════════════════════════════════════
    // Initialize
    // ════════════════════════════════════════════════════════════════════

    function preserveWindowScroll(fn) {
        const x = window.scrollX;
        const y = window.scrollY;
        fn();
        window.scrollTo(x, y);
    }

    function init() {
        if ('scrollRestoration' in history) {
            history.scrollRestoration = 'manual';
        }
        window.scrollTo(0, 0);
        populateExamples();
        buildMemoryGrid();
        attachEventHandlers();
        attachBusListeners();
        loadExample('Hello World');
        updateStatusBar('Ready', 'idle');
        doCompile();
        window.scrollTo(0, 0);
    }

    function populateExamples() {
        if (!exampleSelect) return;
        exampleSelect.innerHTML = '';
        for (const name of Object.keys(EXAMPLES)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            exampleSelect.appendChild(opt);
        }
    }

    function loadExample(name) {
        if (EXAMPLES[name] && editorArea) {
            editorArea.value = EXAMPLES[name];
            if (exampleSelect) exampleSelect.value = name;
            updateSyntaxHighlighting();
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Syntax Highlighting
    // ════════════════════════════════════════════════════════════════════

    function highlightCSyntax(code) {
        if (!code) return '';

        const esc = (str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

        // Token pattern matching C syntax elements
        const tokenRegex = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|(^#\s*\w+[^\n]*)|("(?:\\.|[^"\\])*")|('(?:\\.|[^'\\])*')|\b(0x[0-9a-fA-F]+|\d+)\b|\b(int|void|char|if|else|while|for|return|printf)\b|([a-zA-Z_]\w*)(?=\s*\()|([a-zA-Z_]\w*)|([{}()\[\];,])|([+\-*\/%=&|^~!<>]|&&|\|\||==|!=|<=|>=|\+=|-=|\*=|\/=|\%=|\+\+|--)/gm;

        let result = '';
        let lastIndex = 0;
        let match;

        while ((match = tokenRegex.exec(code)) !== null) {
            if (match.index > lastIndex) {
                result += esc(code.slice(lastIndex, match.index));
            }

            const [
                full,
                comment,
                preproc,
                strLit,
                charLit,
                num,
                keyword,
                funcName,
                ident,
                punct,
                op
            ] = match;

            if (comment) {
                result += `<span class="hl-comment">${esc(comment)}</span>`;
            } else if (preproc) {
                result += `<span class="hl-preproc">${esc(preproc)}</span>`;
            } else if (strLit || charLit) {
                result += `<span class="hl-string">${esc(strLit || charLit)}</span>`;
            } else if (num) {
                result += `<span class="hl-number">${esc(num)}</span>`;
            } else if (keyword) {
                result += `<span class="hl-keyword">${esc(keyword)}</span>`;
            } else if (funcName) {
                result += `<span class="hl-func">${esc(funcName)}</span>`;
            } else if (ident) {
                result += `<span class="hl-ident">${esc(ident)}</span>`;
            } else if (punct || op) {
                result += `<span class="hl-punct">${esc(punct || op)}</span>`;
            } else {
                result += esc(full);
            }

            lastIndex = tokenRegex.lastIndex;
        }

        if (lastIndex < code.length) {
            result += esc(code.slice(lastIndex));
        }

        if (code.endsWith('\n')) {
            result += '\n';
        }

        return result;
    }

    function updateSyntaxHighlighting() {
        if (!editorArea || !highlightingContent) return;
        highlightingContent.innerHTML = highlightCSyntax(editorArea.value);
        syncEditorScroll();
    }

    function syncEditorScroll() {
        if (!editorArea || !editorHighlight) return;
        editorHighlight.scrollTop = editorArea.scrollTop;
        editorHighlight.scrollLeft = editorArea.scrollLeft;
    }

    // ════════════════════════════════════════════════════════════════════
    // Memory Grid (showing first 512 bytes of 4KB)
    // ════════════════════════════════════════════════════════════════════

    const memoryCells = [];

    function buildMemoryGrid() {
        if (!memoryGrid) return;
        memoryGrid.innerHTML = '';

        // Header row
        const headerRow = document.createElement('div');
        headerRow.className = 'mem-row mem-header';
        const corner = document.createElement('div');
        corner.className = 'mem-label mem-corner';
        corner.textContent = '';
        headerRow.appendChild(corner);
        for (let c = 0; c < MEM_DISPLAY_COLS; c++) {
            const h = document.createElement('div');
            h.className = 'mem-label';
            h.textContent = c.toString(16).toUpperCase();
            headerRow.appendChild(h);
        }
        memoryGrid.appendChild(headerRow);

        for (let row = 0; row < MEM_DISPLAY_ROWS; row++) {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'mem-row';

            const label = document.createElement('div');
            label.className = 'mem-label';
            label.textContent = (row * MEM_DISPLAY_COLS).toString(16).toUpperCase().padStart(3, '0');
            rowDiv.appendChild(label);

            for (let col = 0; col < MEM_DISPLAY_COLS; col++) {
                const addr = row * MEM_DISPLAY_COLS + col;
                const cell = document.createElement('div');
                cell.className = 'mem-cell';
                cell.dataset.addr = addr;
                cell.textContent = '00';
                cell.title = `0x${addr.toString(16).toUpperCase().padStart(3, '0')}: 0`;

                // Color region
                const region = cpu.memory.getRegion(addr);
                cell.classList.add(`mem-${region.key}`);

                memoryCells[addr] = cell;
                rowDiv.appendChild(cell);
            }

            memoryGrid.appendChild(rowDiv);
        }
    }

    function updateMemoryGrid() {
        for (let i = 0; i < MEM_DISPLAY_SIZE; i++) {
            const val = cpu.memory.peek(i);
            const cell = memoryCells[i];
            if (!cell) continue;
            cell.textContent = val.toString(16).toUpperCase().padStart(2, '0');
            cell.title = `0x${i.toString(16).toUpperCase().padStart(3, '0')}: ${val} (0b${val.toString(2).padStart(8, '0')})`;
        }
    }

    function flashMemoryCell(addr, className = 'mem-flash') {
        const cell = memoryCells[addr];
        if (!cell) return;
        cell.classList.add(className);
        setTimeout(() => cell.classList.remove(className), 600);
    }

    // ════════════════════════════════════════════════════════════════════
    // Register Display (32-bit, 8 registers)
    // ════════════════════════════════════════════════════════════════════

    let regFormatHex = true;

    function fmtReg32(val) {
        if (!regFormatHex) return String(val >>> 0);
        return ((val >>> 0)).toString(16).toUpperCase().padStart(8, '0');
    }

    function fmtAddr(val) {
        if (!regFormatHex) return String(val & 0xFFFF);
        return (val & 0xFFFF).toString(16).toUpperCase().padStart(3, '0');
    }

    function updateRegisters() {
        const setReg = (el, val, digits = 8) => {
            if (!el) return;
            const text = digits === 8 ? fmtReg32(val) : fmtAddr(val);
            if (el.textContent !== text) {
                el.textContent = text;
                el.classList.add('reg-flash');
                setTimeout(() => el.classList.remove('reg-flash'), 500);
            }
        };

        for (let i = 0; i < 8; i++) {
            setReg(regEls[i], cpu.registers.get(i), 8);
        }
        setReg(regPC, cpu.registers.pc, 3);
        if (cycleCount) cycleCount.textContent = cpu.cycleCount;
        const badgeCyc = $('#badge-cycles');
        if (badgeCyc) badgeCyc.textContent = `${cpu.cycleCount} cyc`;
    }

    function updateFlags() {
        const setFlag = (el, val) => {
            if (!el) return;
            el.textContent = val ? '1' : '0';
            el.classList.toggle('flag-active', val);
        };

        setFlag(flagZ, cpu.flags.zero);
        setFlag(flagN, cpu.flags.negative);
        setFlag(flagC, cpu.flags.carry);
        setFlag(flagV, cpu.flags.overflow);
    }

    // ════════════════════════════════════════════════════════════════════
    // Preprocessed Code Display
    // ════════════════════════════════════════════════════════════════════

    function renderPreprocessedCode(code, headers) {
        if (!prepPanel) return;
        prepPanel.innerHTML = highlightCSyntax(code || '// No preprocessed code available');
        const badge = $('#prep-header-badge');
        if (badge) {
            const count = headers ? headers.length : 0;
            badge.textContent = `${count} header${count !== 1 ? 's' : ''} expanded`;
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Token Display
    // ════════════════════════════════════════════════════════════════════

    function renderTokens(tokens) {
        if (!tokenPanel) return;
        tokenPanel.innerHTML = '';

        const badge = $('#token-count-badge');
        if (badge) {
            const count = tokens.filter(tok => tok.type !== 'EOF').length;
            badge.textContent = `${count} token${count !== 1 ? 's' : ''}`;
        }

        for (const tok of tokens) {
            if (tok.type === 'EOF') continue;
            const chip = document.createElement('span');
            chip.className = `token-chip token-${tok.type.toLowerCase()}`;

            if (tok.type === 'STRING') {
                chip.textContent = `"${tok.raw.replace(/^"|"$/g, '')}"`;
            } else {
                chip.textContent = tok.type === 'NUMBER' ? tok.raw : tok.value;
            }

            const label = document.createElement('span');
            label.className = 'token-label';
            label.textContent = tok.type;

            const wrapper = document.createElement('div');
            wrapper.className = 'token-wrapper';
            wrapper.appendChild(chip);
            wrapper.appendChild(label);

            tokenPanel.appendChild(wrapper);
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // AST Display
    // ════════════════════════════════════════════════════════════════════

    function renderAST(ast) {
        if (!astPanel) return;
        astPanel.innerHTML = '';
        const tree = buildASTTree(ast, 0);
        astPanel.appendChild(tree);
    }

    function buildASTTree(node, depth) {
        const div = document.createElement('div');
        div.className = `ast-node ast-depth-${Math.min(depth, 5)}`;
        div.style.paddingLeft = `${depth * 12}px`;

        const nodeType = getASTNodeClass(node.type);
        const header = document.createElement('span');
        header.className = `ast-label ast-${nodeType}`;

        switch (node.type) {
            case 'Program':
                header.textContent = '📦 Program';
                break;
            case 'FunctionDecl':
                header.textContent = `🔧 ${node.returnType} ${node.name}()`;
                break;
            case 'VarDecl':
                header.textContent = `📌 int ${node.name}`;
                if (node.initializer) header.textContent += ' = ...';
                break;
            case 'Assignment':
                header.textContent = `✏️ ${node.name} = ...`;
                break;
            case 'CompoundAssign':
                header.textContent = `✏️ ${node.name} ${node.operator} ...`;
                break;
            case 'IncDec':
                header.textContent = `✏️ ${node.name}${node.operator}`;
                break;
            case 'IfStatement':
                header.textContent = '🔀 if (...)';
                break;
            case 'WhileStatement':
                header.textContent = '🔁 while (...)';
                break;
            case 'ForStatement':
                header.textContent = '🔁 for (...)';
                break;
            case 'Block':
                header.textContent = '{ ... }';
                break;
            case 'PrintfStatement':
                header.textContent = '🖨️ printf(...)';
                break;
            case 'ReturnStatement':
                header.textContent = '↩️ return';
                if (node.value) header.textContent += ' ...';
                break;
            case 'BinaryExpression':
                header.textContent = `⚙️ ${node.operator}`;
                break;
            case 'LogicalExpression':
                header.textContent = `🔗 ${node.operator}`;
                break;
            case 'UnaryExpression':
                header.textContent = `⚙️ ${node.operator}(unary)`;
                break;
            case 'NumberLiteral':
                header.textContent = `🔢 ${node.value}`;
                break;
            case 'StringLiteral':
                header.textContent = `📝 "${node.value.substring(0, 20)}${node.value.length > 20 ? '...' : ''}"`;
                break;
            case 'Identifier':
                header.textContent = `📎 ${node.name}`;
                break;
            default:
                header.textContent = node.type;
        }

        div.appendChild(header);

        // Children
        const children = getASTChildren(node);
        for (const child of children) {
            if (child) {
                div.appendChild(buildASTTree(child, depth + 1));
            }
        }

        return div;
    }

    function getASTNodeClass(type) {
        const map = {
            'Program': 'program',
            'FunctionDecl': 'function',
            'VarDecl': 'data',
            'Assignment': 'data',
            'CompoundAssign': 'data',
            'IncDec': 'data',
            'IfStatement': 'control',
            'WhileStatement': 'control',
            'ForStatement': 'control',
            'Block': 'block',
            'PrintfStatement': 'io',
            'ReturnStatement': 'control',
            'BinaryExpression': 'expr',
            'LogicalExpression': 'expr',
            'UnaryExpression': 'expr',
            'NumberLiteral': 'literal',
            'StringLiteral': 'literal',
            'Identifier': 'ident',
        };
        return map[type] || 'default';
    }

    function getASTChildren(node) {
        const children = [];
        switch (node.type) {
            case 'Program':
            case 'Block':
                return node.body || [];
            case 'FunctionDecl':
                children.push(node.body);
                return children;
            case 'VarDecl':
                if (node.initializer) children.push(node.initializer);
                return children;
            case 'Assignment':
                children.push(node.value);
                return children;
            case 'CompoundAssign':
                children.push(node.value);
                return children;
            case 'IfStatement':
                children.push(node.condition);
                children.push(node.consequent);
                if (node.alternate) children.push(node.alternate);
                return children;
            case 'WhileStatement':
                children.push(node.condition);
                children.push(node.body);
                return children;
            case 'ForStatement':
                if (node.init) children.push(node.init);
                if (node.condition) children.push(node.condition);
                if (node.update) children.push(node.update);
                children.push(node.body);
                return children;
            case 'PrintfStatement':
                for (const arg of (node.args || [])) {
                    children.push(arg);
                }
                return children;
            case 'ReturnStatement':
                if (node.value) children.push(node.value);
                return children;
            case 'BinaryExpression':
            case 'LogicalExpression':
                children.push(node.left);
                children.push(node.right);
                return children;
            case 'UnaryExpression':
                children.push(node.operand);
                return children;
            default:
                return [];
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Semantic Analysis & Symbol Table Display
    // ════════════════════════════════════════════════════════════════════

    // ════════════════════════════════════════════════════════════════════
    // Semantic Analysis & Symbol Table Display
    // ════════════════════════════════════════════════════════════════════

    function renderSemanticSymbols(symbolTable, genSymbols) {
        if (!symbolPanel) return;
        const map = genSymbols || symbolTable;
        if (!map || map.size === 0) {
            symbolPanel.innerHTML = '<div class="symbol-empty">// No symbols registered in symbol table</div>';
            return;
        }

        let html = `
        <div class="symbol-table-wrapper">
            <table class="symbol-table">
                <thead>
                    <tr>
                        <th>Identifier</th>
                        <th>Data Type</th>
                        <th>Scope</th>
                        <th>Memory Offset</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>`;

        for (const [name, info] of map) {
            const addr = typeof info === 'number' ? info : (info.address !== undefined ? info.address : 0);
            const addrHex = `0x${addr.toString(16).toUpperCase().padStart(3, '0')}`;
            const type = typeof info === 'object' && info.type ? info.type : 'int32_t';
            const scope = typeof info === 'object' && info.scope ? info.scope : 'local';

            html += `
                <tr>
                    <td><code class="sym-name">${escapeHtml(name)}</code></td>
                    <td><span class="sym-badge sym-type">${escapeHtml(type)}</span></td>
                    <td><span class="sym-badge sym-scope">${escapeHtml(scope)}</span></td>
                    <td><code class="sym-addr">${addrHex}</code></td>
                    <td><span class="sym-badge sym-valid">✓ Resolved</span></td>
                </tr>`;
        }

        html += `
                </tbody>
            </table>
        </div>`;

        symbolPanel.innerHTML = html;
    }

    // ════════════════════════════════════════════════════════════════════
    // Intermediate Representation (3AC IR Display)
    // ════════════════════════════════════════════════════════════════════

    function highlight3ACIR(text) {
        if (!text) return '';
        const lines = text.split('\n');
        return lines.map(line => {
            if (line.trim().startsWith('//')) {
                return `<span class="ir-comment">${escapeHtml(line)}</span>`;
            }
            let html = escapeHtml(line);
            // Line numbers 000:
            html = html.replace(/^(\d+:)/g, '<span class="ir-linenum">$1</span>');
            // Labels e.g. L_IR0: or main:
            html = html.replace(/\b([A-Za-z_]\w*:)/g, '<span class="ir-label">$1</span>');
            // Keywords
            html = html.replace(/\b(if_false|goto|param|call|return|decl)\b/g, '<span class="ir-kw">$1</span>');
            // Temporaries
            html = html.replace(/\b(t\d+)\b/g, '<span class="ir-temp">$1</span>');
            // Inline comments /* ... */
            html = html.replace(/(\/\*.*?\*\/)/g, '<span class="ir-comment">$1</span>');
            // Numbers
            html = html.replace(/\b(\d+)\b/g, '<span class="ir-number">$1</span>');
            return html;
        }).join('\n');
    }

    function renderRawIR(rawIR) {
        if (!rawIRPanel) return;
        if (!rawIR || rawIR.length === 0) {
            rawIRPanel.innerHTML = '<span class="ir-comment">// No Three-Address Code (3AC) IR generated</span>';
            return;
        }
        let text = '// ── Raw Three-Address Code (3AC IR) ──\n';
        text += '// Target-Independent quadruple statements and temporaries\n\n';
        text += rawIR.map((inst, i) => `${String(i).padStart(3, '0')}: ${inst.text || `${inst.target || ''} ${inst.op} ${inst.arg1 || ''} ${inst.arg2 || ''}`}`).join('\n');
        rawIRPanel.innerHTML = highlight3ACIR(text);
    }

    function renderOptimizedIR(optIR) {
        if (!optIRPanel) return;
        if (!optIR || optIR.length === 0) {
            optIRPanel.innerHTML = '<span class="ir-comment">// No Optimized IR generated</span>';
            return;
        }
        let text = '// ── Optimized Intermediate Representation (Opt IR) ──\n';
        text += '// Transformed via Constant Folding & Dead Code Elimination\n\n';
        text += optIR.map((inst, i) => `${String(i).padStart(3, '0')}: ${inst.text || `${inst.target || ''} ${inst.op} ${inst.arg1 || ''} ${inst.arg2 || ''}`}`).join('\n');
        optIRPanel.innerHTML = highlight3ACIR(text);
    }

    // ════════════════════════════════════════════════════════════════════
    // Assembly Display
    // ════════════════════════════════════════════════════════════════════

    function renderAssembly(listing, labels) {
        if (!asmPanel) return;
        asmPanel.innerHTML = '';

        const labelsByAddr = {};
        if (labels) {
            for (const [name, addr] of Object.entries(labels)) {
                labelsByAddr[addr] = name;
            }
        }

        for (const entry of listing) {
            if (labelsByAddr[entry.address]) {
                const labelDiv = document.createElement('div');
                labelDiv.className = 'asm-label';
                labelDiv.textContent = `${labelsByAddr[entry.address]}:`;
                asmPanel.appendChild(labelDiv);
            }

            const lineDiv = document.createElement('div');
            lineDiv.className = 'asm-line';
            lineDiv.dataset.address = entry.address;
            if (cpu.breakpoints.has(entry.address)) {
                lineDiv.classList.add('has-breakpoint');
            }

            // Breakpoint gutter marker
            const bpSpan = document.createElement('span');
            bpSpan.className = 'asm-bp';
            bpSpan.title = 'Click to toggle breakpoint';
            bpSpan.addEventListener('click', (e) => {
                e.stopPropagation();
                cpu.toggleBreakpoint(entry.address);
                lineDiv.classList.toggle('has-breakpoint', cpu.breakpoints.has(entry.address));
                const isSet = cpu.breakpoints.has(entry.address);
                const addrHex = `0x${entry.address.toString(16).toUpperCase().padStart(3, '0')}`;
                updateStatusBar(isSet ? `Breakpoint set at ${addrHex}` : `Breakpoint removed from ${addrHex}`, isSet ? 'ready' : 'idle');
            });

            const addrSpan = document.createElement('span');
            addrSpan.className = 'asm-addr';
            addrSpan.textContent = `0x${entry.address.toString(16).toUpperCase().padStart(3, '0')}`;

            const hexSpan = document.createElement('span');
            hexSpan.className = 'asm-hex';
            hexSpan.textContent = entry.bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

            const textSpan = document.createElement('span');
            textSpan.className = 'asm-text';
            textSpan.textContent = entry.text;

            lineDiv.appendChild(bpSpan);
            lineDiv.appendChild(addrSpan);
            lineDiv.appendChild(hexSpan);
            lineDiv.appendChild(textSpan);

            asmPanel.appendChild(lineDiv);
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Bytecode Display
    // ════════════════════════════════════════════════════════════════════

    let bytecodeFormatHex = true;

    function renderBytecode(bytes) {
        if (!bytecodePanel) return;
        bytecodePanel.innerHTML = '';

        const grid = document.createElement('div');
        grid.className = 'bytecode-grid';

        for (let i = 0; i < bytes.length; i++) {
            const cell = document.createElement('span');
            cell.className = 'bytecode-byte';
            cell.textContent = bytecodeFormatHex ?
                bytes[i].toString(16).toUpperCase().padStart(2, '0') :
                bytes[i].toString(10);
            cell.title = `Offset 0x${i.toString(16).toUpperCase().padStart(3, '0')}: ${bytes[i]} (0b${bytes[i].toString(2).padStart(8, '0')})`;
            cell.dataset.offset = i;
            grid.appendChild(cell);
        }

        bytecodePanel.appendChild(grid);

        const summary = document.createElement('div');
        summary.className = 'bytecode-summary';
        summary.textContent = `${bytes.length} bytes (${bytecodeFormatHex ? 'Hexadecimal' : 'Decimal'} view)`;
        bytecodePanel.appendChild(summary);
    }

    // ════════════════════════════════════════════════════════════════════
    // Console Output (supports printf-style streaming)
    // ════════════════════════════════════════════════════════════════════

    let consoleBuffer = '';

    function appendConsole(text, type = 'output') {
        if (!consolePanel) return;
        const line = document.createElement('div');
        line.className = `console-line console-${type}`;
        line.textContent = text;
        consolePanel.appendChild(line);
        consolePanel.scrollTop = consolePanel.scrollHeight;
    }

    function appendConsoleInline(text) {
        if (!consolePanel) return;
        // Find or create current output line
        let currentLine = consolePanel.querySelector('.console-line.console-current');
        if (!currentLine) {
            currentLine = document.createElement('div');
            currentLine.className = 'console-line console-output console-current';
            consolePanel.appendChild(currentLine);
        }
        consoleBuffer += text;
        currentLine.textContent = consoleBuffer;
        consolePanel.scrollTop = consolePanel.scrollHeight;
    }

    function flushConsoleLine() {
        if (!consolePanel) return;
        const currentLine = consolePanel.querySelector('.console-line.console-current');
        if (currentLine) {
            currentLine.classList.remove('console-current');
        }
        consoleBuffer = '';
    }

    function clearConsole() {
        if (consolePanel) consolePanel.innerHTML = '';
        consoleBuffer = '';
    }

    // ════════════════════════════════════════════════════════════════════
    // Trace Display
    // ════════════════════════════════════════════════════════════════════

    function updateTrace() {
        if (!tracePanel) return;
        tracePanel.innerHTML = '';

        const trace = cpu.trace;
        const startIdx = Math.max(0, trace.length - 50);

        for (let i = startIdx; i < trace.length; i++) {
            const entry = trace[i];
            const line = document.createElement('div');
            line.className = 'trace-line';

            const cycleSpan = document.createElement('span');
            cycleSpan.className = 'trace-cycle';
            cycleSpan.textContent = `#${entry.cycle}`;

            const pcSpan = document.createElement('span');
            pcSpan.className = 'trace-pc';
            pcSpan.textContent = `0x${entry.pc.toString(16).toUpperCase().padStart(3, '0')}`;

            const textSpan = document.createElement('span');
            textSpan.className = 'trace-text';
            textSpan.textContent = entry.text;

            const descSpan = document.createElement('span');
            descSpan.className = 'trace-desc';
            descSpan.textContent = entry.description;

            line.appendChild(cycleSpan);
            line.appendChild(pcSpan);
            line.appendChild(textSpan);
            line.appendChild(descSpan);

            tracePanel.appendChild(line);
        }

        tracePanel.scrollTop = tracePanel.scrollHeight;
    }

    // ════════════════════════════════════════════════════════════════════
    // Highlight Current Instruction
    // ════════════════════════════════════════════════════════════════════

    function highlightCurrentInstruction() {
        $$('.asm-line.asm-current').forEach(el => el.classList.remove('asm-current'));
        for (let i = 0; i < MEM_DISPLAY_SIZE; i++) {
            const c = memoryCells[i];
            if (c) c.classList.remove('mem-pc');
        }

        if (!isCompiled || cpu.halted) return;

        const pc = cpu.registers.pc;

        const asmLine = $(`.asm-line[data-address="${pc}"]`);
        if (asmLine) {
            asmLine.classList.add('asm-current');
            // Scroll inside assembly panel container only during CPU execution, keeping page window stationary
            if (asmPanel && cpu.running) {
                asmPanel.scrollTop = asmLine.offsetTop - asmPanel.offsetTop - 30;
            }
        }

        if (pc < MEM_DISPLAY_SIZE && memoryCells[pc]) {
            memoryCells[pc].classList.add('mem-pc');
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Actions
    // ════════════════════════════════════════════════════════════════════

    function doCompile() {
        if (!editorArea) return;

        const source = editorArea.value;
        clearConsole();

        updateStatusBar('Compiling...', 'busy');

        const result = compiler.compile(source);

        if (result.success) {
            isCompiled = true;
            compiledData = result;

            // Load into CPU
            cpu.loadProgram(result.bytecode);

            // Also load string data into memory
            if (result.strings && result.strings.length > 0) {
                for (const strData of result.strings) {
                    for (let i = 0; i < strData.bytes.length; i++) {
                        cpu.memory.poke(strData.addr + i, strData.bytes[i]);
                    }
                }
            }

            // Render all panels while preserving main window scroll
            preserveWindowScroll(() => {
                renderPreprocessedCode(result.preprocessedCode, result.expandedHeaders);
                renderTokens(result.tokens);
                renderAST(result.ast);
                renderSemanticSymbols(result.symbolTable, result.symbols);
                renderRawIR(result.rawIR);
                renderOptimizedIR(result.optimizedIR);
                renderAssembly(result.listing, result.labels);
                renderBytecode(result.bytecode);
                updateMemoryGrid();
                updateRegisters();
                updateFlags();
                highlightCurrentInstruction();
            });

            appendConsole(`✓ Compiled: ${result.bytecode.length} bytes, ${result.listing.length} instructions`, 'info');

            if (result.symbols && result.symbols.size > 0) {
                let varInfo = 'Variables: ';
                for (const [name, addr] of result.symbols) {
                    varInfo += `${name}@0x${addr.toString(16).toUpperCase().padStart(3, '0')} `;
                }
                appendConsole(varInfo, 'info');
            }

            updateStatusBar('Compiled', 'success');
            const badgeTok = $('#badge-tokens');
            if (badgeTok && result.tokens) {
                const count = result.tokens.filter(tok => tok.type !== 'EOF').length;
                badgeTok.textContent = `${count} tok`;
            }
        } else {
            isCompiled = false;
            for (const err of result.errors) {
                appendConsole(`✗ [${err.stage || 'error'}] Line ${err.line}: ${err.message}`, 'error');
            }
            updateStatusBar('Compile Error', 'error');
        }
    }

    function doStep() {
        if (!isCompiled) {
            doCompile();
            if (!isCompiled) return;
        }

        if (cpu.halted) {
            appendConsole('Program halted. Reset to run again.', 'info');
            return;
        }

        const activeTab = document.body.dataset.activeTab;
        if (activeTab === 'pane-source' || activeTab === 'pane-compiler') {
            switchTab('pane-studio');
        }

        cpu.step();
        updateRegisters();
        updateFlags();
        updateMemoryGrid();
        updateTrace();
        highlightCurrentInstruction();

        if (cpu.halted) {
            flushConsoleLine();
            updateStatusBar('Halted', 'halted');
            appendConsole(`Program halted after ${cpu.cycleCount} cycles.`, 'info');
        } else {
            updateStatusBar(`Cycle ${cpu.cycleCount}`, 'running');
        }
    }

    function doRun() {
        if (!isCompiled) {
            doCompile();
            if (!isCompiled) return;
        }

        if (cpu.halted) {
            appendConsole('Program halted. Reset to run again.', 'info');
            return;
        }

        const activeTab = document.body.dataset.activeTab;
        if (activeTab === 'pane-source' || activeTab === 'pane-compiler') {
            switchTab('pane-studio');
        }

        updateStatusBar('Running...', 'running');
        setButtonStates(true);
        cpu.speed = getSpeedValue();
        cpu.run();
    }

    function doFastRun() {
        if (!isCompiled) {
            doCompile();
            if (!isCompiled) return;
        }

        if (cpu.halted) {
            appendConsole('Program halted. Reset to run again.', 'info');
            return;
        }

        const activeTab = document.body.dataset.activeTab;
        if (activeTab === 'pane-source' || activeTab === 'pane-compiler') {
            switchTab('pane-studio');
        }

        updateStatusBar('Running (fast)...', 'running');
        cpu.runToEnd();
        flushConsoleLine();
        updateRegisters();
        updateFlags();
        updateMemoryGrid();
        updateTrace();
        highlightCurrentInstruction();

        if (cpu.halted) {
            updateStatusBar(`Halted (${cpu.cycleCount} cycles)`, 'halted');
            appendConsole(`Program halted after ${cpu.cycleCount} cycles.`, 'info');
        }
    }

    function doPause() {
        cpu.pause();
        setButtonStates(false);
        updateStatusBar('Paused', 'paused');
    }

    function doReset() {
        cpu.pause();
        setButtonStates(false);

        if (compiledData) {
            cpu.loadProgram(compiledData.bytecode);
            // Reload string data
            if (compiledData.strings && compiledData.strings.length > 0) {
                for (const strData of compiledData.strings) {
                    for (let i = 0; i < strData.bytes.length; i++) {
                        cpu.memory.poke(strData.addr + i, strData.bytes[i]);
                    }
                }
            }
            updateMemoryGrid();
        } else {
            cpu.reset();
        }

        updateRegisters();
        updateFlags();
        updateTrace();
        highlightCurrentInstruction();
        clearConsole();
        appendConsole('Reset.', 'info');
        updateStatusBar('Ready', 'idle');
    }

    // ════════════════════════════════════════════════════════════════════
    // Speed Control
    // ════════════════════════════════════════════════════════════════════

    function getSpeedValue() {
        if (!speedSlider) return 5;
        const val = parseInt(speedSlider.value);
        if (val <= 50) {
            return Math.round(1 + (val / 50) * 9);
        } else {
            return Math.round(10 + ((val - 50) / 50) * 990);
        }
    }

    function updateSpeedLabel() {
        if (!speedLabel || !speedSlider) return;
        const speed = getSpeedValue();
        if (speed >= 100) {
            speedLabel.textContent = `${speed} Hz (burst)`;
        } else {
            speedLabel.textContent = `${speed} Hz`;
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Stage Helper & Utility Functions
    // ════════════════════════════════════════════════════════════════════

    function copyTextWithFeedback(text, btnEl) {
        if (!text) return;
        const originalHtml = btnEl ? btnEl.innerHTML : '';
        navigator.clipboard.writeText(text).then(() => {
            if (btnEl) {
                btnEl.textContent = '✓ Copied!';
                setTimeout(() => { btnEl.innerHTML = originalHtml; }, 1400);
            }
        }).catch(err => {
            console.error('Clipboard copy error:', err);
        });
    }

    let astExpanded = true;
    function setASTExpanded(expanded) {
        astExpanded = expanded;
        if (!astPanel) return;
        const subNodes = astPanel.querySelectorAll('.ast-node .ast-node');
        subNodes.forEach(node => {
            node.style.display = expanded ? 'block' : 'none';
        });
    }

    function scrollToMemAddr(addr) {
        if (!memoryGrid) return;
        const cell = memoryCells[addr];
        if (cell) {
            memoryGrid.scrollTop = cell.offsetTop - memoryGrid.offsetTop - 30;
            flashMemoryCell(addr, 'mem-pc');
        }
    }

    function downloadBinary() {
        if (!compiledData || !compiledData.bytecode) return;
        const blob = new Blob([new Uint8Array(compiledData.bytecode)], { type: 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'program.bin';
        a.click();
        URL.revokeObjectURL(url);
    }

    function exportTraceLog() {
        if (!cpu.trace || cpu.trace.length === 0) return;
        const text = cpu.trace.map(t => `#${t.cycle} [PC: 0x${t.pc.toString(16).padStart(3, '0')}] ${t.text} — ${t.description}`).join('\n');
        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'execution_trace.txt';
        a.click();
        URL.revokeObjectURL(url);
    }

    // ════════════════════════════════════════════════════════════════════
    // Button States
    // ════════════════════════════════════════════════════════════════════

    function setButtonStates(isRunning) {
        $$('.btn-run-action').forEach(el => el.disabled = isRunning);
        $$('.btn-step-action').forEach(el => el.disabled = isRunning);
        $$('.btn-pause-action').forEach(el => el.disabled = !isRunning);
        $$('.btn-fast-action').forEach(el => el.disabled = isRunning);
        $$('.btn-compile-action').forEach(el => el.disabled = isRunning);
    }

    // ════════════════════════════════════════════════════════════════════
    // Status Bar
    // ════════════════════════════════════════════════════════════════════

    function updateStatusBar(text, state) {
        if (statusText) statusText.textContent = text;
        if (statusLed) {
            statusLed.className = 'status-led';
            statusLed.classList.add(`led-${state}`);
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Tab Navigation & Workspace Layout
    // ════════════════════════════════════════════════════════════════════

    function switchTab(targetId) {
        const tabBtns = $$('.tab-btn');
        const tabPanes = $$('.tab-pane');

        tabBtns.forEach(btn => {
            const isMatch = btn.dataset.tab === targetId;
            btn.classList.toggle('active', isMatch);
            btn.setAttribute('aria-selected', isMatch ? 'true' : 'false');
        });

        document.body.dataset.activeTab = targetId;

        if (targetId === 'tab-pipeline') {
            tabPanes.forEach(p => p.classList.add('active'));
            updateStatusBar('Viewing Full Pipeline Flow (All 13 Stages)', 'idle');
        } else {
            tabPanes.forEach(p => {
                const isMatch = p.id === targetId;
                p.classList.toggle('active', isMatch);
            });
            const tabName = $(`[data-tab="${targetId}"] .tab-label`)?.textContent || targetId;
            updateStatusBar(`Switched to ${tabName}`, 'idle');
        }

        localStorage.setItem('minicpu_active_tab', targetId);
    }

    function initTabNavigation() {
        const tabBtns = $$('.tab-btn');
        tabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                switchTab(btn.dataset.tab);
            });
        });

        // Compiler subnav buttons
        const subnavBtns = $$('.compiler-subnav .subnav-btn');
        const compilerStages = $$('#pane-compiler .stage');
        const compilerConnectors = $$('#pane-compiler .pipeline-connector');

        subnavBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                subnavBtns.forEach(b => b.classList.toggle('active', b === btn));
                const targetStage = btn.dataset.stage;
                if (targetStage === 'all') {
                    compilerStages.forEach(s => s.style.display = 'block');
                    compilerConnectors.forEach(c => c.style.display = 'flex');
                } else {
                    compilerStages.forEach(s => {
                        s.style.display = (s.id === targetStage) ? 'block' : 'none';
                    });
                    compilerConnectors.forEach(c => c.style.display = 'none');
                }
            });
        });

        // Restore saved tab or default to pane-studio
        const savedTab = localStorage.getItem('minicpu_active_tab') || 'pane-studio';
        switchTab(savedTab);

        // Keyboard navigation (Alt+1..5)
        document.addEventListener('keydown', (e) => {
            if (e.altKey && !e.ctrlKey && !e.shiftKey) {
                const tabMap = {
                    '1': 'pane-studio',
                    '2': 'pane-source',
                    '3': 'pane-compiler',
                    '4': 'pane-memory',
                    '5': 'tab-pipeline'
                };
                if (tabMap[e.key]) {
                    e.preventDefault();
                    switchTab(tabMap[e.key]);
                }
            }
        });
    }

    // ════════════════════════════════════════════════════════════════════
    // Event Handlers
    // ════════════════════════════════════════════════════════════════════

    function attachEventHandlers() {
        // ─── Retro Terminal Phosphor CRT & Theme Management ───────────
        const themeSelect = $('#theme-select');
        const btnCrtToggle = $('#btn-crt-toggle');

        let currentTheme = localStorage.getItem('minicpu_theme') || 'crt-green';
        let crtFxEnabled = localStorage.getItem('minicpu_crt_fx') !== 'false';

        function applyTheme(theme) {
            currentTheme = theme;
            document.documentElement.setAttribute('data-theme', theme);
            localStorage.setItem('minicpu_theme', theme);
            if (themeSelect) themeSelect.value = theme;
        }

        function setCrtEffects(enabled) {
            crtFxEnabled = enabled;
            document.documentElement.setAttribute('data-crt-effects', enabled ? 'true' : 'false');
            localStorage.setItem('minicpu_crt_fx', enabled ? 'true' : 'false');
            if (btnCrtToggle) {
                btnCrtToggle.textContent = enabled ? '📺 CRT FX: ON' : '📺 CRT FX: OFF';
                btnCrtToggle.classList.toggle('crt-off', !enabled);
            }
        }

        if (themeSelect) {
            themeSelect.addEventListener('change', () => {
                applyTheme(themeSelect.value);
            });
        }

        if (btnCrtToggle) {
            btnCrtToggle.addEventListener('click', () => {
                setCrtEffects(!crtFxEnabled);
            });
        }

        applyTheme(currentTheme);
        setCrtEffects(crtFxEnabled);
        initTabNavigation();

        // Multi-instance buttons (Header & Stage 6 Assembly bar)
        $$('.btn-compile-action').forEach(el => el.addEventListener('click', doCompile));
        $$('.btn-run-action').forEach(el => el.addEventListener('click', doRun));
        $$('.btn-step-action').forEach(el => el.addEventListener('click', doStep));
        $$('.btn-pause-action').forEach(el => el.addEventListener('click', doPause));
        $$('.btn-reset-action').forEach(el => el.addEventListener('click', doReset));
        $$('.btn-fast-action').forEach(el => el.addEventListener('click', doFastRun));

        // Stage 1 Source Code Actions
        const btnCopySource = $('#btn-copy-source');
        if (btnCopySource) {
            btnCopySource.addEventListener('click', () => {
                copyTextWithFeedback(editorArea ? editorArea.value : '', btnCopySource);
            });
        }
        const btnClearSource = $('#btn-clear-source');
        if (btnClearSource) {
            btnClearSource.addEventListener('click', () => {
                if (editorArea) {
                    editorArea.value = '';
                    updateSyntaxHighlighting();
                }
            });
        }

        // Stage 2 Preprocessed Code Actions
        const btnCopyPrep = $('#btn-copy-prep');
        if (btnCopyPrep) {
            btnCopyPrep.addEventListener('click', () => {
                copyTextWithFeedback(prepPanel ? prepPanel.textContent : '', btnCopyPrep);
            });
        }

        // Stage 2 Token Actions
        const btnCopyTokens = $('#btn-copy-tokens');
        if (btnCopyTokens) {
            btnCopyTokens.addEventListener('click', () => {
                if (!compiledData || !compiledData.tokens) return;
                const tokStr = compiledData.tokens.map(t => `[${t.type}] ${t.value || t.raw}`).join(' ');
                copyTextWithFeedback(tokStr, btnCopyTokens);
            });
        }

        // Stage 3 AST Actions
        const btnAstExpand = $('#btn-ast-expand');
        if (btnAstExpand) btnAstExpand.addEventListener('click', () => setASTExpanded(true));
        const btnAstCollapse = $('#btn-ast-collapse');
        if (btnAstCollapse) btnAstCollapse.addEventListener('click', () => setASTExpanded(false));
        const btnCopyAst = $('#btn-copy-ast');
        if (btnCopyAst) {
            btnCopyAst.addEventListener('click', () => {
                copyTextWithFeedback(astPanel ? astPanel.innerText : '', btnCopyAst);
            });
        }

        // Stage 5 Semantic Symbol Table Actions
        const btnCopySymbols = $('#btn-copy-symbols');
        if (btnCopySymbols) {
            btnCopySymbols.addEventListener('click', () => {
                copyTextWithFeedback(symbolPanel ? symbolPanel.textContent : '', btnCopySymbols);
            });
        }

        // Stage 6 Raw IR Actions
        const btnCopyRawIR = $('#btn-copy-raw-ir');
        if (btnCopyRawIR) {
            btnCopyRawIR.addEventListener('click', () => {
                copyTextWithFeedback(rawIRPanel ? rawIRPanel.textContent : '', btnCopyRawIR);
            });
        }

        // Stage 7 Opt IR Actions
        const btnCopyOptIR = $('#btn-copy-opt-ir');
        if (btnCopyOptIR) {
            btnCopyOptIR.addEventListener('click', () => {
                copyTextWithFeedback(optIRPanel ? optIRPanel.textContent : '', btnCopyOptIR);
            });
        }

        // Stage 4 Machine Code Actions
        const btnBytecodeFormat = $('#btn-bytecode-hex-dec');
        if (btnBytecodeFormat) {
            btnBytecodeFormat.addEventListener('click', () => {
                bytecodeFormatHex = !bytecodeFormatHex;
                if (compiledData && compiledData.bytecode) {
                    renderBytecode(compiledData.bytecode);
                }
            });
        }
        const btnCopyBytecode = $('#btn-copy-bytecode');
        if (btnCopyBytecode) {
            btnCopyBytecode.addEventListener('click', () => {
                if (!compiledData || !compiledData.bytecode) return;
                const bytesStr = compiledData.bytecode.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
                copyTextWithFeedback(bytesStr, btnCopyBytecode);
            });
        }
        const btnDownloadBin = $('#btn-download-bin');
        if (btnDownloadBin) btnDownloadBin.addEventListener('click', downloadBinary);

        // Stage 5 Memory Actions
        const btnMemPC = $('#btn-mem-pc');
        if (btnMemPC) btnMemPC.addEventListener('click', () => scrollToMemAddr(cpu.registers.pc));
        const btnMemSP = $('#btn-mem-sp');
        if (btnMemSP) btnMemSP.addEventListener('click', () => scrollToMemAddr(cpu.registers.sp));
        const btnClearMem = $('#btn-clear-mem');
        if (btnClearMem) {
            btnClearMem.addEventListener('click', () => {
                cpu.memory.reset();
                updateMemoryGrid();
                appendConsole('Memory zeroed.', 'info');
            });
        }

        // Stage 6 Assembly Actions
        const btnCopyAsm = $('#btn-copy-asm');
        if (btnCopyAsm) {
            btnCopyAsm.addEventListener('click', () => {
                if (!compiledData || !compiledData.listing) return;
                const asmStr = compiledData.listing.map(e => `0x${e.address.toString(16).toUpperCase().padStart(3, '0')}:  ${e.text}`).join('\n');
                copyTextWithFeedback(asmStr, btnCopyAsm);
            });
        }

        // Stage 7 CPU State Actions
        const btnCpuFormat = $('#btn-cpu-format');
        if (btnCpuFormat) {
            btnCpuFormat.addEventListener('click', () => {
                regFormatHex = !regFormatHex;
                updateRegisters();
            });
        }
        const btnCpuResetRegs = $('#btn-cpu-reset-regs');
        if (btnCpuResetRegs) {
            btnCpuResetRegs.addEventListener('click', () => {
                for (let i = 0; i < 8; i++) cpu.registers.set(i, 0);
                cpu.registers.pc = 0;
                cpu.registers.sp = 0xFFC;
                cpu.flags.zero = 0;
                cpu.flags.negative = 0;
                cpu.flags.carry = 0;
                cpu.flags.overflow = 0;
                updateRegisters();
                updateFlags();
                highlightCurrentInstruction();
                appendConsole('CPU Registers reset.', 'info');
            });
        }

        // Stage 8 Console Actions
        const btnClearConsole = $('#btn-clear-console');
        if (btnClearConsole) btnClearConsole.addEventListener('click', clearConsole);
        const btnCopyConsole = $('#btn-copy-console');
        if (btnCopyConsole) {
            btnCopyConsole.addEventListener('click', () => {
                copyTextWithFeedback(consolePanel ? consolePanel.innerText : '', btnCopyConsole);
            });
        }

        // Stage 9 Trace Actions
        const btnClearTrace = $('#btn-clear-trace');
        if (btnClearTrace) {
            btnClearTrace.addEventListener('click', () => {
                cpu.trace = [];
                updateTrace();
            });
        }
        const btnExportTrace = $('#btn-export-trace');
        if (btnExportTrace) btnExportTrace.addEventListener('click', exportTraceLog);

        if (speedSlider) {
            speedSlider.addEventListener('input', () => {
                updateSpeedLabel();
                if (cpu.running) {
                    cpu.speed = getSpeedValue();
                }
            });
            updateSpeedLabel();
        }

        if (exampleSelect) {
            exampleSelect.addEventListener('change', () => {
                const currentX = window.scrollX;
                const currentY = window.scrollY;
                if (document.activeElement === exampleSelect) {
                    exampleSelect.blur();
                }
                loadExample(exampleSelect.value);
                doReset();
                doCompile();
                window.scrollTo(currentX, currentY);
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            if (document.activeElement === editorArea && !e.ctrlKey && !e.metaKey) return;

            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                doCompile();
            } else if (e.key === 'F5') {
                e.preventDefault();
                doRun();
            } else if (e.key === 'F10') {
                e.preventDefault();
                doStep();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                doPause();
            }
        });

        // Syntax Highlighting & Editor Input Events
        if (editorArea) {
            editorArea.addEventListener('input', updateSyntaxHighlighting);
            editorArea.addEventListener('scroll', syncEditorScroll);

            editorArea.addEventListener('keydown', (e) => {
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const start = editorArea.selectionStart;
                    const end = editorArea.selectionEnd;
                    editorArea.value = editorArea.value.substring(0, start) + '    ' + editorArea.value.substring(end);
                    editorArea.selectionStart = editorArea.selectionEnd = start + 4;
                    updateSyntaxHighlighting();
                }
            });
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Bus Listeners — React to CPU/Compiler events
    // ════════════════════════════════════════════════════════════════════

    function attachBusListeners() {
        // CPU output (printf syscalls)
        bus.on('output', (data) => {
            if (data.type === 'int') {
                appendConsoleInline(String(data.value));
            } else if (data.type === 'string') {
                appendConsoleInline(data.value);
            } else if (data.type === 'char') {
                appendConsoleInline(data.value);
            } else if (data.type === 'newline') {
                flushConsoleLine();
            } else {
                // Fallback for legacy OUT instruction
                appendConsole(`→ ${data.value}`, 'output');
            }
        });

        // CPU halted
        bus.on('cpuHalted', () => {
            flushConsoleLine();
            setButtonStates(false);
            updateStatusBar(`Halted (${cpu.cycleCount} cycles)`, 'halted');
        });

        // CPU stopped (after run)
        bus.on('cpuStopped', () => {
            setButtonStates(false);
            updateRegisters();
            updateFlags();
            updateMemoryGrid();
            updateTrace();
            highlightCurrentInstruction();
        });

        // Breakpoint hit
        bus.on('breakpointHit', (data) => {
            doPause();
            const addrHex = `0x${data.pc.toString(16).toUpperCase().padStart(3, '0')}`;
            updateStatusBar(`⏸ Breakpoint hit at ${addrHex}`, 'paused');
            appendConsole(`[DEBUG] Breakpoint reached at ${addrHex} (cycle #${data.cycle})`, 'system');
            highlightCurrentInstruction();
            const hitLine = $(`.asm-line[data-address="${data.pc}"]`);
            if (hitLine) {
                hitLine.classList.add('breakpoint-hit');
                setTimeout(() => hitLine.classList.remove('breakpoint-hit'), 1500);
            }
        });

        // Memory write flash
        bus.on('memoryWrite', (data) => {
            if (data.address < MEM_DISPLAY_SIZE) {
                flashMemoryCell(data.address, 'mem-write-flash');
                const cell = memoryCells[data.address];
                if (cell) {
                    const val = data.width === 32 ? (data.value & 0xFF) : data.value;
                    cell.textContent = (val & 0xFF).toString(16).toUpperCase().padStart(2, '0');
                }
            }
        });

        // Memory read flash
        bus.on('memoryRead', (data) => {
            if (data.address < MEM_DISPLAY_SIZE) {
                flashMemoryCell(data.address, 'mem-read-flash');
            }
        });

        // Instruction executed (for slow mode updates)
        bus.on('instructionExecuted', () => {
            if (cpu.running && cpu.speed < 100) {
                updateRegisters();
                updateFlags();
                updateTrace();
                highlightCurrentInstruction();
            }
        });

        // Errors
        bus.on('error', (data) => {
            appendConsole(`⚠ ${data.type}: ${data.message}`, 'error');
        });
    }

    // ════════════════════════════════════════════════════════════════════
    // Boot
    // ════════════════════════════════════════════════════════════════════

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
