// ============================================================================
// app.js — MiniCPU Application Layer
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

    let compiledData = null;      // Last successful compilation result
    let isCompiled = false;

    // ════════════════════════════════════════════════════════════════════
    // Example Programs
    // ════════════════════════════════════════════════════════════════════

    const EXAMPLES = {
        'Sum 1..10': `// Sum of 1 to 10
int sum = 0;
int i = 1;
while (i <= 10) {
    sum = sum + i;
    i = i + 1;
}
print(sum);`,

        'Countdown': `// Countdown from 10
int n = 10;
while (n > 0) {
    print(n);
    n = n - 1;
}
print(0);`,

        'Multiply': `// Multiply via addition
int a = 7;
int b = 6;
int result = 0;
int i = 0;
while (i < b) {
    result = result + a;
    i = i + 1;
}
print(result);`,

        'If/Else': `// Max of two numbers
int x = 42;
int y = 17;
int max = 0;
if (x > y) {
    max = x;
} else {
    max = y;
}
print(max);`,

        'Fibonacci': `// First 10 Fibonacci numbers
int a = 0;
int b = 1;
int i = 0;
int temp = 0;
while (i < 10) {
    print(a);
    temp = a + b;
    a = b;
    b = temp;
    i = i + 1;
}`,

        'Squares': `// Print squares 1..8
int i = 1;
while (i <= 8) {
    print(i * i);
    i = i + 1;
}`,

        'Nested If': `// Classify a number
int x = 50;
if (x > 100) {
    print(3);
} else {
    if (x > 30) {
        print(2);
    } else {
        print(1);
    }
}`,

        'Power of 2': `// Compute 2^8
int base = 2;
int exp = 8;
int result = 1;
int i = 0;
while (i < exp) {
    result = result * base;
    i = i + 1;
}
print(result);`,
    };

    // ════════════════════════════════════════════════════════════════════
    // DOM References
    // ════════════════════════════════════════════════════════════════════

    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    // Editor
    const editorArea = $('#source-editor');

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
    const tokenPanel    = $('#token-output');
    const astPanel      = $('#ast-output');
    const asmPanel      = $('#asm-output');
    const bytecodePanel = $('#bytecode-output');
    const consolePanel  = $('#console-output');
    const tracePanel    = $('#trace-output');

    // CPU Display
    const regR0   = $('#reg-r0');
    const regR1   = $('#reg-r1');
    const regR2   = $('#reg-r2');
    const regR3   = $('#reg-r3');
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
    // Initialize
    // ════════════════════════════════════════════════════════════════════

    function init() {
        populateExamples();
        buildMemoryGrid();
        attachEventHandlers();
        attachBusListeners();
        loadExample('Sum 1..10');
        updateStatusBar('Ready', 'idle');
        // Auto-compile on load
        setTimeout(() => doCompile(), 200);
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
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Memory Grid
    // ════════════════════════════════════════════════════════════════════

    const memoryCells = [];

    function buildMemoryGrid() {
        if (!memoryGrid) return;
        memoryGrid.innerHTML = '';

        // Header row
        const headerRow = document.createElement('div');
        headerRow.className = 'mem-row mem-header';
        const corner = document.createElement('div');
        corner.className = 'mem-label';
        corner.textContent = '';
        headerRow.appendChild(corner);
        for (let c = 0; c < 16; c++) {
            const h = document.createElement('div');
            h.className = 'mem-label';
            h.textContent = c.toString(16).toUpperCase();
            headerRow.appendChild(h);
        }
        memoryGrid.appendChild(headerRow);

        for (let row = 0; row < 16; row++) {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'mem-row';

            const label = document.createElement('div');
            label.className = 'mem-label';
            label.textContent = (row * 16).toString(16).toUpperCase().padStart(2, '0');
            rowDiv.appendChild(label);

            for (let col = 0; col < 16; col++) {
                const addr = row * 16 + col;
                const cell = document.createElement('div');
                cell.className = 'mem-cell';
                cell.dataset.addr = addr;
                cell.textContent = '00';
                cell.title = `0x${addr.toString(16).toUpperCase().padStart(2, '0')}: 0`;

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
        for (let i = 0; i < MiniCPU.MEMORY_SIZE; i++) {
            const val = cpu.memory.peek(i);
            const cell = memoryCells[i];
            if (!cell) continue;
            cell.textContent = val.toString(16).toUpperCase().padStart(2, '0');
            cell.title = `0x${i.toString(16).toUpperCase().padStart(2, '0')}: ${val} (0b${val.toString(2).padStart(8, '0')})`;
        }
    }

    function flashMemoryCell(addr, className = 'mem-flash') {
        const cell = memoryCells[addr];
        if (!cell) return;
        cell.classList.add(className);
        setTimeout(() => cell.classList.remove(className), 600);
    }

    // ════════════════════════════════════════════════════════════════════
    // Register Display
    // ════════════════════════════════════════════════════════════════════

    function updateRegisters() {
        const setReg = (el, val) => {
            if (!el) return;
            const text = val.toString(16).toUpperCase().padStart(2, '0');
            if (el.textContent !== text) {
                el.textContent = text;
                el.classList.add('reg-flash');
                setTimeout(() => el.classList.remove('reg-flash'), 500);
            }
        };

        setReg(regR0, cpu.registers.get(0));
        setReg(regR1, cpu.registers.get(1));
        setReg(regR2, cpu.registers.get(2));
        setReg(regR3, cpu.registers.get(3));
        setReg(regPC, cpu.registers.pc);
        setReg(regSP, cpu.registers.sp);

        if (cycleCount) cycleCount.textContent = cpu.cycleCount;
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
    // Token Display
    // ════════════════════════════════════════════════════════════════════

    function renderTokens(tokens) {
        if (!tokenPanel) return;
        tokenPanel.innerHTML = '';

        for (const tok of tokens) {
            if (tok.type === 'EOF') continue;
            const chip = document.createElement('span');
            chip.className = `token-chip token-${tok.type.toLowerCase()}`;
            chip.textContent = tok.type === 'NUMBER' ? tok.raw : tok.value;

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
            case 'VarDecl':
                header.textContent = `📌 int ${node.name}`;
                if (node.initializer) {
                    header.textContent += ' = ...';
                }
                break;
            case 'Assignment':
                header.textContent = `✏️ ${node.name} = ...`;
                break;
            case 'IfStatement':
                header.textContent = '🔀 if (...)';
                break;
            case 'WhileStatement':
                header.textContent = '🔁 while (...)';
                break;
            case 'Block':
                header.textContent = '{ ... }';
                break;
            case 'PrintStatement':
                header.textContent = '🖨️ print(...)';
                break;
            case 'BinaryExpression':
                header.textContent = `⚙️ ${node.operator}`;
                break;
            case 'UnaryExpression':
                header.textContent = `⚙️ ${node.operator}(unary)`;
                break;
            case 'NumberLiteral':
                header.textContent = `🔢 ${node.value}`;
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
            'VarDecl': 'data',
            'Assignment': 'data',
            'IfStatement': 'control',
            'WhileStatement': 'control',
            'Block': 'block',
            'PrintStatement': 'io',
            'BinaryExpression': 'expr',
            'UnaryExpression': 'expr',
            'NumberLiteral': 'literal',
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
            case 'VarDecl':
                if (node.initializer) children.push(node.initializer);
                return children;
            case 'Assignment':
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
            case 'PrintStatement':
                children.push(node.value);
                return children;
            case 'BinaryExpression':
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
    // Assembly Display
    // ════════════════════════════════════════════════════════════════════

    function renderAssembly(listing, labels) {
        if (!asmPanel) return;
        asmPanel.innerHTML = '';

        // Show labels at their addresses
        const labelsByAddr = {};
        if (labels) {
            for (const [name, addr] of Object.entries(labels)) {
                labelsByAddr[addr] = name;
            }
        }

        for (const entry of listing) {
            // Check for label at this address
            if (labelsByAddr[entry.address]) {
                const labelDiv = document.createElement('div');
                labelDiv.className = 'asm-label';
                labelDiv.textContent = `${labelsByAddr[entry.address]}:`;
                asmPanel.appendChild(labelDiv);
            }

            const lineDiv = document.createElement('div');
            lineDiv.className = 'asm-line';
            lineDiv.dataset.address = entry.address;

            const addrSpan = document.createElement('span');
            addrSpan.className = 'asm-addr';
            addrSpan.textContent = `0x${entry.address.toString(16).toUpperCase().padStart(2, '0')}`;

            const hexSpan = document.createElement('span');
            hexSpan.className = 'asm-hex';
            hexSpan.textContent = entry.bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

            const textSpan = document.createElement('span');
            textSpan.className = 'asm-text';
            textSpan.textContent = entry.text;

            lineDiv.appendChild(addrSpan);
            lineDiv.appendChild(hexSpan);
            lineDiv.appendChild(textSpan);

            asmPanel.appendChild(lineDiv);
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Bytecode Display
    // ════════════════════════════════════════════════════════════════════

    function renderBytecode(bytes) {
        if (!bytecodePanel) return;
        bytecodePanel.innerHTML = '';

        const grid = document.createElement('div');
        grid.className = 'bytecode-grid';

        for (let i = 0; i < bytes.length; i++) {
            const cell = document.createElement('span');
            cell.className = 'bytecode-byte';
            cell.textContent = bytes[i].toString(16).toUpperCase().padStart(2, '0');
            cell.title = `Offset 0x${i.toString(16).toUpperCase().padStart(2, '0')}: ${bytes[i]} (0b${bytes[i].toString(2).padStart(8, '0')})`;
            cell.dataset.offset = i;
            grid.appendChild(cell);
        }

        bytecodePanel.appendChild(grid);

        // Summary
        const summary = document.createElement('div');
        summary.className = 'bytecode-summary';
        summary.textContent = `${bytes.length} bytes`;
        bytecodePanel.appendChild(summary);
    }

    // ════════════════════════════════════════════════════════════════════
    // Console Output
    // ════════════════════════════════════════════════════════════════════

    function appendConsole(text, type = 'output') {
        if (!consolePanel) return;
        const line = document.createElement('div');
        line.className = `console-line console-${type}`;
        line.textContent = text;
        consolePanel.appendChild(line);
        consolePanel.scrollTop = consolePanel.scrollHeight;
    }

    function clearConsole() {
        if (consolePanel) consolePanel.innerHTML = '';
    }

    // ════════════════════════════════════════════════════════════════════
    // Trace Display
    // ════════════════════════════════════════════════════════════════════

    function updateTrace() {
        if (!tracePanel) return;
        tracePanel.innerHTML = '';

        const trace = cpu.trace;
        const startIdx = Math.max(0, trace.length - 50); // Show last 50

        for (let i = startIdx; i < trace.length; i++) {
            const entry = trace[i];
            const line = document.createElement('div');
            line.className = 'trace-line';

            const cycleSpan = document.createElement('span');
            cycleSpan.className = 'trace-cycle';
            cycleSpan.textContent = `#${entry.cycle}`;

            const pcSpan = document.createElement('span');
            pcSpan.className = 'trace-pc';
            pcSpan.textContent = `0x${entry.pc.toString(16).toUpperCase().padStart(2, '0')}`;

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
        // Clear old highlights
        $$('.asm-line.asm-current').forEach(el => el.classList.remove('asm-current'));
        memoryCells.forEach(c => {
            if (c) c.classList.remove('mem-pc');
        });

        if (!isCompiled || cpu.halted) return;

        const pc = cpu.registers.pc;

        // Highlight in assembly listing
        const asmLine = $(`.asm-line[data-address="${pc}"]`);
        if (asmLine) {
            asmLine.classList.add('asm-current');
            asmLine.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        // Highlight in memory
        if (memoryCells[pc]) {
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

            // Render all panels
            renderTokens(result.tokens);
            renderAST(result.ast);
            renderAssembly(result.listing, result.labels);
            renderBytecode(result.bytecode);
            updateMemoryGrid();
            updateRegisters();
            updateFlags();
            highlightCurrentInstruction();

            appendConsole(`✓ Compiled: ${result.bytecode.length} bytes, ${result.listing.length} instructions`, 'info');

            // Show variable mapping
            if (result.symbols && result.symbols.size > 0) {
                let varInfo = 'Variables: ';
                for (const [name, addr] of result.symbols) {
                    varInfo += `${name}@0x${addr.toString(16).toUpperCase().padStart(2, '0')} `;
                }
                appendConsole(varInfo, 'info');
            }

            updateStatusBar('Compiled', 'success');
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

        cpu.step();
        updateRegisters();
        updateFlags();
        updateMemoryGrid();
        updateTrace();
        highlightCurrentInstruction();

        if (cpu.halted) {
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

        updateStatusBar('Running (fast)...', 'running');
        cpu.runToEnd();
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
        // Exponential scale: 1=1Hz, 50=10Hz, 100=1000Hz
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
    // Button States
    // ════════════════════════════════════════════════════════════════════

    function setButtonStates(isRunning) {
        if (btnRun) btnRun.disabled = isRunning;
        if (btnStep) btnStep.disabled = isRunning;
        if (btnPause) btnPause.disabled = !isRunning;
        if (btnFast) btnFast.disabled = isRunning;
        if (btnCompile) btnCompile.disabled = isRunning;
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
    // Event Handlers
    // ════════════════════════════════════════════════════════════════════

    function attachEventHandlers() {
        if (btnCompile) btnCompile.addEventListener('click', doCompile);
        if (btnRun)     btnRun.addEventListener('click', doRun);
        if (btnStep)    btnStep.addEventListener('click', doStep);
        if (btnPause)   btnPause.addEventListener('click', doPause);
        if (btnReset)   btnReset.addEventListener('click', doReset);
        if (btnFast)    btnFast.addEventListener('click', doFastRun);

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
                loadExample(exampleSelect.value);
                doReset();
                setTimeout(() => doCompile(), 100);
            });
        }

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Don't capture when typing in editor
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
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
                // Don't capture browser refresh
            }
        });

        // Tab support in editor
        if (editorArea) {
            editorArea.addEventListener('keydown', (e) => {
                if (e.key === 'Tab') {
                    e.preventDefault();
                    const start = editorArea.selectionStart;
                    const end = editorArea.selectionEnd;
                    editorArea.value = editorArea.value.substring(0, start) + '    ' + editorArea.value.substring(end);
                    editorArea.selectionStart = editorArea.selectionEnd = start + 4;
                }
            });
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Bus Listeners — React to CPU/Compiler events
    // ════════════════════════════════════════════════════════════════════

    function attachBusListeners() {
        // CPU output
        bus.on('output', (data) => {
            appendConsole(`→ ${data.value}`, 'output');
        });

        // CPU halted
        bus.on('cpuHalted', () => {
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

        // Memory write flash
        bus.on('memoryWrite', (data) => {
            flashMemoryCell(data.address, 'mem-write-flash');
            // Update the cell immediately
            const cell = memoryCells[data.address];
            if (cell) {
                cell.textContent = data.value.toString(16).toUpperCase().padStart(2, '0');
            }
        });

        // Memory read flash
        bus.on('memoryRead', (data) => {
            flashMemoryCell(data.address, 'mem-read-flash');
        });

        // Instruction executed (for slow mode updates)
        bus.on('instructionExecuted', () => {
            if (cpu.running && cpu.speed < 100) {
                updateRegisters();
                updateFlags();
                updateTrace();
                highlightCurrentInstruction();
                // Update specific memory cells instead of full grid
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
