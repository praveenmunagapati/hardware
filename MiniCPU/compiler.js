// ============================================================================
// compiler.js — MiniCPU Compiler
// ============================================================================
// Contains: Lexer, Parser, AST, Semantic Analysis, Code Generator
// Compiles a minimal C-like language to MiniCPU assembly
// ============================================================================

'use strict';

// ============================================================================
// Token Types
// ============================================================================

const TokenType = {
    // Literals
    NUMBER:     'NUMBER',
    IDENTIFIER: 'IDENTIFIER',
    // Keywords
    INT:        'INT',
    IF:         'IF',
    ELSE:       'ELSE',
    WHILE:      'WHILE',
    PRINT:      'PRINT',
    // Operators
    PLUS:       'PLUS',
    MINUS:      'MINUS',
    STAR:       'STAR',
    // Assignment
    ASSIGN:     'ASSIGN',
    // Comparison
    EQ:         'EQ',        // ==
    NEQ:        'NEQ',       // !=
    LT:         'LT',        // <
    GT:         'GT',        // >
    LTE:        'LTE',       // <=
    GTE:        'GTE',       // >=
    // Delimiters
    LPAREN:     'LPAREN',
    RPAREN:     'RPAREN',
    LBRACE:     'LBRACE',
    RBRACE:     'RBRACE',
    SEMICOLON:  'SEMICOLON',
    COMMA:      'COMMA',
    // Special
    EOF:        'EOF',
    ERROR:      'ERROR',
};

const KEYWORDS = {
    'int':   TokenType.INT,
    'if':    TokenType.IF,
    'else':  TokenType.ELSE,
    'while': TokenType.WHILE,
    'print': TokenType.PRINT,
};

// Token class
class Token {
    constructor(type, value, line, col, raw = null) {
        this.type = type;
        this.value = value;
        this.line = line;
        this.col = col;
        this.raw = raw || value;
    }

    toString() {
        return `[${this.type} "${this.value}" L${this.line}:${this.col}]`;
    }
}


// ============================================================================
// Lexer — Converts source text to tokens
// ============================================================================

class Lexer {
    constructor(source) {
        this.source = source;
        this.pos = 0;
        this.line = 1;
        this.col = 1;
        this.tokens = [];
        this.errors = [];
        this._steps = []; // For animation: each step shows the lexer state
    }

    get steps() { return this._steps; }

    tokenize() {
        this.tokens = [];
        this.errors = [];
        this._steps = [];
        this.pos = 0;
        this.line = 1;
        this.col = 1;

        while (this.pos < this.source.length) {
            this._skipWhitespace();
            if (this.pos >= this.source.length) break;

            const startPos = this.pos;
            const startLine = this.line;
            const startCol = this.col;
            const ch = this.source[this.pos];

            // Skip single-line comments
            if (ch === '/' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '/') {
                while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
                    this._advance();
                }
                continue;
            }

            // Numbers
            if (this._isDigit(ch)) {
                const token = this._readNumber(startLine, startCol);
                this.tokens.push(token);
                this._steps.push({
                    action: 'token',
                    token: token,
                    charRange: [startPos, this.pos],
                    highlight: `Recognized number: ${token.value}`
                });
                continue;
            }

            // Identifiers and Keywords
            if (this._isAlpha(ch)) {
                const token = this._readIdentifier(startLine, startCol);
                this.tokens.push(token);
                const kind = token.type === TokenType.IDENTIFIER ? 'identifier' : 'keyword';
                this._steps.push({
                    action: 'token',
                    token: token,
                    charRange: [startPos, this.pos],
                    highlight: `Recognized ${kind}: ${token.value}`
                });
                continue;
            }

            // Operators and delimiters
            let token = null;
            switch (ch) {
                case '+':
                    token = new Token(TokenType.PLUS, '+', startLine, startCol);
                    this._advance();
                    break;
                case '-':
                    token = new Token(TokenType.MINUS, '-', startLine, startCol);
                    this._advance();
                    break;
                case '*':
                    token = new Token(TokenType.STAR, '*', startLine, startCol);
                    this._advance();
                    break;
                case '=':
                    this._advance();
                    if (this.pos < this.source.length && this.source[this.pos] === '=') {
                        token = new Token(TokenType.EQ, '==', startLine, startCol, '==');
                        this._advance();
                    } else {
                        token = new Token(TokenType.ASSIGN, '=', startLine, startCol);
                    }
                    break;
                case '!':
                    this._advance();
                    if (this.pos < this.source.length && this.source[this.pos] === '=') {
                        token = new Token(TokenType.NEQ, '!=', startLine, startCol, '!=');
                        this._advance();
                    } else {
                        this.errors.push({ line: startLine, col: startCol, message: `Unexpected character: !` });
                        continue;
                    }
                    break;
                case '<':
                    this._advance();
                    if (this.pos < this.source.length && this.source[this.pos] === '=') {
                        token = new Token(TokenType.LTE, '<=', startLine, startCol, '<=');
                        this._advance();
                    } else {
                        token = new Token(TokenType.LT, '<', startLine, startCol);
                    }
                    break;
                case '>':
                    this._advance();
                    if (this.pos < this.source.length && this.source[this.pos] === '=') {
                        token = new Token(TokenType.GTE, '>=', startLine, startCol, '>=');
                        this._advance();
                    } else {
                        token = new Token(TokenType.GT, '>', startLine, startCol);
                    }
                    break;
                case '(':
                    token = new Token(TokenType.LPAREN, '(', startLine, startCol);
                    this._advance();
                    break;
                case ')':
                    token = new Token(TokenType.RPAREN, ')', startLine, startCol);
                    this._advance();
                    break;
                case '{':
                    token = new Token(TokenType.LBRACE, '{', startLine, startCol);
                    this._advance();
                    break;
                case '}':
                    token = new Token(TokenType.RBRACE, '}', startLine, startCol);
                    this._advance();
                    break;
                case ';':
                    token = new Token(TokenType.SEMICOLON, ';', startLine, startCol);
                    this._advance();
                    break;
                case ',':
                    token = new Token(TokenType.COMMA, ',', startLine, startCol);
                    this._advance();
                    break;
                default:
                    this.errors.push({ line: startLine, col: startCol, message: `Unexpected character: ${ch}` });
                    this._advance();
                    continue;
            }

            if (token) {
                this.tokens.push(token);
                this._steps.push({
                    action: 'token',
                    token: token,
                    charRange: [startPos, this.pos],
                    highlight: `Recognized operator: ${token.value}`
                });
            }
        }

        // Add EOF
        const eofToken = new Token(TokenType.EOF, '', this.line, this.col);
        this.tokens.push(eofToken);

        return { tokens: this.tokens, errors: this.errors, steps: this._steps };
    }

    _advance() {
        if (this.pos < this.source.length) {
            if (this.source[this.pos] === '\n') {
                this.line++;
                this.col = 1;
            } else {
                this.col++;
            }
            this.pos++;
        }
    }

    _skipWhitespace() {
        while (this.pos < this.source.length) {
            const ch = this.source[this.pos];
            if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
                this._advance();
            } else {
                break;
            }
        }
    }

    _isDigit(ch) {
        return ch >= '0' && ch <= '9';
    }

    _isAlpha(ch) {
        return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_';
    }

    _isAlphaNumeric(ch) {
        return this._isAlpha(ch) || this._isDigit(ch);
    }

    _readNumber(startLine, startCol) {
        let value = '';
        while (this.pos < this.source.length && this._isDigit(this.source[this.pos])) {
            value += this.source[this.pos];
            this._advance();
        }
        return new Token(TokenType.NUMBER, parseInt(value, 10), startLine, startCol, value);
    }

    _readIdentifier(startLine, startCol) {
        let value = '';
        while (this.pos < this.source.length && this._isAlphaNumeric(this.source[this.pos])) {
            value += this.source[this.pos];
            this._advance();
        }
        const type = KEYWORDS[value] || TokenType.IDENTIFIER;
        return new Token(type, value, startLine, startCol, value);
    }
}


// ============================================================================
// AST Node Types
// ============================================================================

const ASTNodeType = {
    PROGRAM:        'Program',
    VAR_DECL:       'VarDecl',
    ASSIGNMENT:     'Assignment',
    IF_STMT:        'IfStatement',
    WHILE_STMT:     'WhileStatement',
    BLOCK:          'Block',
    PRINT_STMT:     'PrintStatement',
    BINARY_EXPR:    'BinaryExpression',
    UNARY_EXPR:     'UnaryExpression',
    NUMBER_LITERAL: 'NumberLiteral',
    IDENTIFIER:     'Identifier',
};


// ============================================================================
// Parser — Converts tokens to AST
// ============================================================================

class Parser {
    constructor(tokens) {
        this.tokens = tokens;
        this.pos = 0;
        this.errors = [];
        this._steps = [];
    }

    get steps() { return this._steps; }

    parse() {
        this.pos = 0;
        this.errors = [];
        this._steps = [];

        const statements = [];

        while (!this._isAtEnd()) {
            try {
                const stmt = this._parseStatement();
                if (stmt) {
                    statements.push(stmt);
                    this._steps.push({
                        action: 'parsed',
                        node: stmt,
                        highlight: `Parsed ${stmt.type}`
                    });
                }
            } catch (e) {
                this.errors.push({ line: this._current().line, col: this._current().col, message: e.message });
                this._synchronize();
            }
        }

        const program = {
            type: ASTNodeType.PROGRAM,
            body: statements,
            line: 1
        };

        return { ast: program, errors: this.errors, steps: this._steps };
    }

    // ─── Statement Parsing ──────────────────────────────────────────────
    _parseStatement() {
        const token = this._current();

        switch (token.type) {
            case TokenType.INT:
                return this._parseVarDecl();
            case TokenType.IF:
                return this._parseIfStatement();
            case TokenType.WHILE:
                return this._parseWhileStatement();
            case TokenType.PRINT:
                return this._parsePrintStatement();
            case TokenType.LBRACE:
                return this._parseBlock();
            case TokenType.IDENTIFIER:
                return this._parseAssignment();
            default:
                throw new Error(`Unexpected token: ${token.type} "${token.value}"`);
        }
    }

    _parseVarDecl() {
        const line = this._current().line;
        this._expect(TokenType.INT); // consume 'int'
        const name = this._expect(TokenType.IDENTIFIER).value;

        let initializer = null;
        if (this._match(TokenType.ASSIGN)) {
            initializer = this._parseExpression();
        }

        this._expect(TokenType.SEMICOLON);

        return {
            type: ASTNodeType.VAR_DECL,
            name,
            initializer,
            line
        };
    }

    _parseAssignment() {
        const line = this._current().line;
        const name = this._expect(TokenType.IDENTIFIER).value;
        this._expect(TokenType.ASSIGN);
        const value = this._parseExpression();
        this._expect(TokenType.SEMICOLON);

        return {
            type: ASTNodeType.ASSIGNMENT,
            name,
            value,
            line
        };
    }

    _parseIfStatement() {
        const line = this._current().line;
        this._expect(TokenType.IF);
        this._expect(TokenType.LPAREN);
        const condition = this._parseExpression();
        this._expect(TokenType.RPAREN);
        const consequent = this._parseBlock();

        let alternate = null;
        if (this._check(TokenType.ELSE)) {
            this._advance();
            if (this._check(TokenType.IF)) {
                alternate = this._parseIfStatement();
            } else {
                alternate = this._parseBlock();
            }
        }

        return {
            type: ASTNodeType.IF_STMT,
            condition,
            consequent,
            alternate,
            line
        };
    }

    _parseWhileStatement() {
        const line = this._current().line;
        this._expect(TokenType.WHILE);
        this._expect(TokenType.LPAREN);
        const condition = this._parseExpression();
        this._expect(TokenType.RPAREN);
        const body = this._parseBlock();

        return {
            type: ASTNodeType.WHILE_STMT,
            condition,
            body,
            line
        };
    }

    _parsePrintStatement() {
        const line = this._current().line;
        this._expect(TokenType.PRINT);
        this._expect(TokenType.LPAREN);
        const value = this._parseExpression();
        this._expect(TokenType.RPAREN);
        this._expect(TokenType.SEMICOLON);

        return {
            type: ASTNodeType.PRINT_STMT,
            value,
            line
        };
    }

    _parseBlock() {
        this._expect(TokenType.LBRACE);
        const statements = [];
        while (!this._check(TokenType.RBRACE) && !this._isAtEnd()) {
            const stmt = this._parseStatement();
            if (stmt) statements.push(stmt);
        }
        this._expect(TokenType.RBRACE);

        return {
            type: ASTNodeType.BLOCK,
            body: statements,
            line: statements.length > 0 ? statements[0].line : 0
        };
    }

    // ─── Expression Parsing (Precedence Climbing) ───────────────────────

    _parseExpression() {
        return this._parseComparison();
    }

    _parseComparison() {
        let left = this._parseAddSub();

        while (this._check(TokenType.EQ) || this._check(TokenType.NEQ) ||
               this._check(TokenType.LT) || this._check(TokenType.GT) ||
               this._check(TokenType.LTE) || this._check(TokenType.GTE)) {
            const op = this._advance();
            const right = this._parseAddSub();
            left = {
                type: ASTNodeType.BINARY_EXPR,
                operator: op.value,
                left,
                right,
                line: op.line
            };
        }

        return left;
    }

    _parseAddSub() {
        let left = this._parseMulDiv();

        while (this._check(TokenType.PLUS) || this._check(TokenType.MINUS)) {
            const op = this._advance();
            const right = this._parseMulDiv();
            left = {
                type: ASTNodeType.BINARY_EXPR,
                operator: op.value,
                left,
                right,
                line: op.line
            };
        }

        return left;
    }

    _parseMulDiv() {
        let left = this._parseUnary();

        while (this._check(TokenType.STAR)) {
            const op = this._advance();
            const right = this._parseUnary();
            left = {
                type: ASTNodeType.BINARY_EXPR,
                operator: op.value,
                left,
                right,
                line: op.line
            };
        }

        return left;
    }

    _parseUnary() {
        if (this._check(TokenType.MINUS)) {
            const op = this._advance();
            const operand = this._parsePrimary();
            return {
                type: ASTNodeType.UNARY_EXPR,
                operator: '-',
                operand,
                line: op.line
            };
        }
        return this._parsePrimary();
    }

    _parsePrimary() {
        const token = this._current();

        if (token.type === TokenType.NUMBER) {
            this._advance();
            return {
                type: ASTNodeType.NUMBER_LITERAL,
                value: token.value,
                line: token.line
            };
        }

        if (token.type === TokenType.IDENTIFIER) {
            this._advance();
            return {
                type: ASTNodeType.IDENTIFIER,
                name: token.value,
                line: token.line
            };
        }

        if (token.type === TokenType.LPAREN) {
            this._advance();
            const expr = this._parseExpression();
            this._expect(TokenType.RPAREN);
            return expr;
        }

        throw new Error(`Expected expression, got ${token.type} "${token.value}"`);
    }

    // ─── Token Helpers ──────────────────────────────────────────────────

    _current() {
        return this.tokens[this.pos] || new Token(TokenType.EOF, '', 0, 0);
    }

    _advance() {
        const token = this._current();
        if (!this._isAtEnd()) this.pos++;
        return token;
    }

    _check(type) {
        return this._current().type === type;
    }

    _match(type) {
        if (this._check(type)) {
            this._advance();
            return true;
        }
        return false;
    }

    _expect(type) {
        if (this._check(type)) {
            return this._advance();
        }
        const curr = this._current();
        throw new Error(`Expected ${type}, got ${curr.type} "${curr.value}" at line ${curr.line}`);
    }

    _isAtEnd() {
        return this._current().type === TokenType.EOF;
    }

    _synchronize() {
        // Skip tokens until we find a statement boundary
        while (!this._isAtEnd()) {
            if (this._current().type === TokenType.SEMICOLON) {
                this._advance();
                return;
            }
            if (this._current().type === TokenType.RBRACE) {
                return;
            }
            const nextType = this._current().type;
            if (nextType === TokenType.INT || nextType === TokenType.IF ||
                nextType === TokenType.WHILE || nextType === TokenType.PRINT) {
                return;
            }
            this._advance();
        }
    }
}


// ============================================================================
// Semantic Analyzer — Checks variable declarations, type constraints
// ============================================================================

class SemanticAnalyzer {
    constructor() {
        this.errors = [];
        this.warnings = [];
        this.symbols = new Map(); // variable name -> { address, declared: bool }
    }

    analyze(ast) {
        this.errors = [];
        this.warnings = [];
        this.symbols = new Map();

        if (ast.type === ASTNodeType.PROGRAM) {
            for (const stmt of ast.body) {
                this._analyzeStatement(stmt);
            }
        }

        return { errors: this.errors, warnings: this.warnings, symbols: this.symbols };
    }

    _analyzeStatement(node) {
        switch (node.type) {
            case ASTNodeType.VAR_DECL:
                if (this.symbols.has(node.name)) {
                    this.errors.push({ line: node.line, message: `Variable '${node.name}' already declared` });
                } else {
                    this.symbols.set(node.name, { declared: true });
                }
                if (node.initializer) {
                    this._analyzeExpression(node.initializer);
                }
                break;

            case ASTNodeType.ASSIGNMENT:
                if (!this.symbols.has(node.name)) {
                    this.errors.push({ line: node.line, message: `Variable '${node.name}' not declared` });
                }
                this._analyzeExpression(node.value);
                break;

            case ASTNodeType.IF_STMT:
                this._analyzeExpression(node.condition);
                this._analyzeBody(node.consequent);
                if (node.alternate) {
                    if (node.alternate.type === ASTNodeType.IF_STMT) {
                        this._analyzeStatement(node.alternate);
                    } else {
                        this._analyzeBody(node.alternate);
                    }
                }
                break;

            case ASTNodeType.WHILE_STMT:
                this._analyzeExpression(node.condition);
                this._analyzeBody(node.body);
                break;

            case ASTNodeType.PRINT_STMT:
                this._analyzeExpression(node.value);
                break;

            case ASTNodeType.BLOCK:
                for (const s of node.body) {
                    this._analyzeStatement(s);
                }
                break;
        }
    }

    _analyzeBody(node) {
        if (node.type === ASTNodeType.BLOCK) {
            for (const s of node.body) {
                this._analyzeStatement(s);
            }
        } else {
            this._analyzeStatement(node);
        }
    }

    _analyzeExpression(node) {
        switch (node.type) {
            case ASTNodeType.NUMBER_LITERAL:
                if (node.value < 0 || node.value > 255) {
                    this.warnings.push({ line: node.line, message: `Value ${node.value} will be truncated to 8 bits` });
                }
                break;

            case ASTNodeType.IDENTIFIER:
                if (!this.symbols.has(node.name)) {
                    this.errors.push({ line: node.line, message: `Variable '${node.name}' not declared` });
                }
                break;

            case ASTNodeType.BINARY_EXPR:
                this._analyzeExpression(node.left);
                this._analyzeExpression(node.right);
                break;

            case ASTNodeType.UNARY_EXPR:
                this._analyzeExpression(node.operand);
                break;
        }
    }
}


// ============================================================================
// Code Generator — Compiles AST to MiniCPU assembly instructions
// ============================================================================

class CodeGenerator {
    constructor() {
        this.instructions = [];
        this.symbols = new Map();      // varName -> memAddress
        this.nextDataAddr = window.MiniCPU.DATA_START;
        this.labelCounter = 0;
        this.errors = [];
        this._sourceMap = [];          // Maps assembly lines to source lines
    }

    generate(ast) {
        this.instructions = [];
        this.symbols = new Map();
        this.nextDataAddr = window.MiniCPU.DATA_START;
        this.labelCounter = 0;
        this.errors = [];
        this._sourceMap = [];

        if (ast.type === ASTNodeType.PROGRAM) {
            for (const stmt of ast.body) {
                this._generateStatement(stmt);
            }
        }

        // Add HLT at end
        this._emit('HLT', [], 0);

        return {
            instructions: this.instructions,
            errors: this.errors,
            symbols: this.symbols,
            sourceMap: this._sourceMap
        };
    }

    _newLabel() {
        return `_L${this.labelCounter++}`;
    }

    _allocVar(name) {
        if (this.symbols.has(name)) return this.symbols.get(name);
        const addr = this.nextDataAddr;
        if (addr > window.MiniCPU.STACK_START - 16) {
            this.errors.push({ line: 0, message: `Out of data memory for variable '${name}'` });
            return 0;
        }
        this.symbols.set(name, addr);
        this.nextDataAddr++;
        return addr;
    }

    _emit(mnemonic, operands = [], sourceLine = 0) {
        this.instructions.push({ mnemonic, operands, sourceLine });
    }

    _emitLabel(label, sourceLine = 0) {
        this.instructions.push({ label, mnemonic: null, operands: [], sourceLine });
    }

    // ─── Statement Generation ───────────────────────────────────────────

    _generateStatement(node) {
        switch (node.type) {
            case ASTNodeType.VAR_DECL:
                this._genVarDecl(node);
                break;
            case ASTNodeType.ASSIGNMENT:
                this._genAssignment(node);
                break;
            case ASTNodeType.IF_STMT:
                this._genIfStatement(node);
                break;
            case ASTNodeType.WHILE_STMT:
                this._genWhileStatement(node);
                break;
            case ASTNodeType.PRINT_STMT:
                this._genPrintStatement(node);
                break;
            case ASTNodeType.BLOCK:
                for (const s of node.body) {
                    this._generateStatement(s);
                }
                break;
        }
    }

    _genVarDecl(node) {
        const addr = this._allocVar(node.name);
        if (node.initializer) {
            // Generate expression into R0
            this._generateExpression(node.initializer, 0);
            // Store R0 to address
            this._emit('STORE', ['R0', `${addr}`], node.line);
        }
    }

    _genAssignment(node) {
        const addr = this.symbols.get(node.name);
        if (addr === undefined) {
            this.errors.push({ line: node.line, message: `Undefined variable '${node.name}'` });
            return;
        }
        this._generateExpression(node.value, 0);
        this._emit('STORE', ['R0', `${addr}`], node.line);
    }

    _genIfStatement(node) {
        const elseLabel = this._newLabel();
        const endLabel = this._newLabel();

        // Evaluate condition into R0
        this._generateCondition(node.condition, elseLabel);

        // Consequent body
        this._generateBody(node.consequent);

        if (node.alternate) {
            this._emit('JMP', [endLabel], node.line);
        }

        this._emitLabel(elseLabel, node.line);

        if (node.alternate) {
            if (node.alternate.type === ASTNodeType.IF_STMT) {
                this._generateStatement(node.alternate);
            } else {
                this._generateBody(node.alternate);
            }
            this._emitLabel(endLabel, node.line);
        }
    }

    _genWhileStatement(node) {
        const startLabel = this._newLabel();
        const endLabel = this._newLabel();

        this._emitLabel(startLabel, node.line);

        // Evaluate condition
        this._generateCondition(node.condition, endLabel);

        // Body
        this._generateBody(node.body);

        this._emit('JMP', [startLabel], node.line);
        this._emitLabel(endLabel, node.line);
    }

    _genPrintStatement(node) {
        this._generateExpression(node.value, 0);
        this._emit('OUT', ['R0'], node.line);
    }

    _generateBody(node) {
        if (node.type === ASTNodeType.BLOCK) {
            for (const s of node.body) {
                this._generateStatement(s);
            }
        } else {
            this._generateStatement(node);
        }
    }

    // ─── Expression Generation ──────────────────────────────────────────
    // Generates code that puts the result of the expression into register `dest`
    // Uses the stack for complex expressions

    _generateExpression(node, dest) {
        switch (node.type) {
            case ASTNodeType.NUMBER_LITERAL:
                this._emit('MOV', [`R${dest}`, `${node.value & 0xFF}`], node.line);
                break;

            case ASTNodeType.IDENTIFIER: {
                const addr = this.symbols.get(node.name);
                if (addr === undefined) {
                    this.errors.push({ line: node.line, message: `Undefined variable '${node.name}'` });
                    return;
                }
                this._emit('LOAD', [`R${dest}`, `${addr}`], node.line);
                break;
            }

            case ASTNodeType.UNARY_EXPR:
                if (node.operator === '-') {
                    this._emit('MOV', [`R${dest}`, '0'], node.line);
                    this._generateExpression(node.operand, 1);
                    this._emit('SUB', [`R${dest}`, 'R1'], node.line);
                }
                break;

            case ASTNodeType.BINARY_EXPR:
                this._genBinaryExpr(node, dest);
                break;
        }
    }

    _genBinaryExpr(node, dest) {
        const op = node.operator;

        // For arithmetic: evaluate left into R0, push, evaluate right into R0,
        // pop left into R1, compute
        if (op === '+' || op === '-' || op === '*') {
            // Left operand -> R0
            this._generateExpression(node.left, 0);
            // Save R0 on stack
            this._emit('PUSH', ['R0'], node.line);
            // Right operand -> R0
            this._generateExpression(node.right, 0);
            // Move right to R1
            this._emit('MOV', ['R1', 'R0'], node.line);
            // Pop left into R0
            this._emit('POP', ['R0'], node.line);

            // Perform operation
            switch (op) {
                case '+': this._emit('ADD', ['R0', 'R1'], node.line); break;
                case '-': this._emit('SUB', ['R0', 'R1'], node.line); break;
                case '*': this._emit('MUL', ['R0', 'R1'], node.line); break;
            }

            // Move result to destination if needed
            if (dest !== 0) {
                this._emit('MOV', [`R${dest}`, 'R0'], node.line);
            }
        }
    }

    // ─── Condition Generation ───────────────────────────────────────────
    // Generates code that jumps to `falseLabel` if the condition is false

    _generateCondition(node, falseLabel) {
        if (node.type === ASTNodeType.BINARY_EXPR &&
            ['==', '!=', '<', '>', '<=', '>='].includes(node.operator)) {

            // Left into R0
            this._generateExpression(node.left, 0);
            // Save
            this._emit('PUSH', ['R0'], node.line);
            // Right into R0
            this._generateExpression(node.right, 0);
            // Move right to R1
            this._emit('MOV', ['R1', 'R0'], node.line);
            // Pop left into R0
            this._emit('POP', ['R0'], node.line);
            // Compare
            this._emit('CMP', ['R0', 'R1'], node.line);

            // Jump to false label based on opposite condition
            switch (node.operator) {
                case '==': this._emit('JNZ', [falseLabel], node.line); break;
                case '!=': this._emit('JZ',  [falseLabel], node.line); break;
                case '<':  this._emit('JGE', [falseLabel], node.line); break;
                case '>':  this._emit('JLE', [falseLabel], node.line); break;
                case '<=': this._emit('JG',  [falseLabel], node.line); break;
                case '>=': this._emit('JL',  [falseLabel], node.line); break;
            }
        } else {
            // Treat as truthy/falsy: evaluate and jump if zero
            this._generateExpression(node, 0);
            this._emit('CMP', ['R0', '0'], node.line);
            this._emit('JZ', [falseLabel], node.line);
        }
    }
}


// ============================================================================
// Compiler — Orchestrates the full compilation pipeline
// ============================================================================

class Compiler {
    constructor(bus) {
        this.bus = bus;
        this.lexer = null;
        this.parser = null;
        this.analyzer = new SemanticAnalyzer();
        this.generator = new CodeGenerator();

        // Pipeline results
        this.source = '';
        this.tokens = [];
        this.ast = null;
        this.assembly = [];
        this.bytecode = [];
        this.listing = [];
        this.errors = [];
        this.labels = {};
        this.symbols = new Map();
        this.lexerSteps = [];
        this.parserSteps = [];
    }

    /**
     * Full compilation pipeline:
     * Source → Tokens → AST → Semantic Check → Assembly → Machine Code
     * Returns { success, errors, bytecode, listing, ast, tokens, assembly, symbols, labels }
     */
    compile(source) {
        this.source = source;
        this.errors = [];

        // Stage 1: Lexing
        this.bus.emit('compileStage', { stage: 'lexer', status: 'running' });
        this.lexer = new Lexer(source);
        const lexResult = this.lexer.tokenize();
        this.tokens = lexResult.tokens;
        this.lexerSteps = lexResult.steps;

        if (lexResult.errors.length > 0) {
            this.errors = lexResult.errors.map(e => ({
                stage: 'lexer',
                ...e
            }));
            this.bus.emit('compileStage', { stage: 'lexer', status: 'error', errors: this.errors });
            this.bus.emit('compileFailed', { errors: this.errors });
            return { success: false, errors: this.errors };
        }
        this.bus.emit('compileStage', { stage: 'lexer', status: 'done', tokens: this.tokens });

        // Stage 2: Parsing
        this.bus.emit('compileStage', { stage: 'parser', status: 'running' });
        this.parser = new Parser(this.tokens);
        const parseResult = this.parser.parse();
        this.ast = parseResult.ast;
        this.parserSteps = parseResult.steps;

        if (parseResult.errors.length > 0) {
            this.errors = parseResult.errors.map(e => ({
                stage: 'parser',
                ...e
            }));
            this.bus.emit('compileStage', { stage: 'parser', status: 'error', errors: this.errors });
            this.bus.emit('compileFailed', { errors: this.errors });
            return { success: false, errors: this.errors };
        }
        this.bus.emit('compileStage', { stage: 'parser', status: 'done', ast: this.ast });

        // Stage 3: Semantic Analysis
        this.bus.emit('compileStage', { stage: 'semantic', status: 'running' });
        const semResult = this.analyzer.analyze(this.ast);
        this.symbols = semResult.symbols;

        if (semResult.errors.length > 0) {
            this.errors = semResult.errors.map(e => ({
                stage: 'semantic',
                ...e
            }));
            this.bus.emit('compileStage', { stage: 'semantic', status: 'error', errors: this.errors });
            this.bus.emit('compileFailed', { errors: this.errors });
            return { success: false, errors: this.errors };
        }
        this.bus.emit('compileStage', { stage: 'semantic', status: 'done' });

        // Stage 4: Code Generation
        this.bus.emit('compileStage', { stage: 'codegen', status: 'running' });
        const genResult = this.generator.generate(this.ast);
        this.assembly = genResult.instructions;

        if (genResult.errors.length > 0) {
            this.errors = genResult.errors.map(e => ({
                stage: 'codegen',
                ...e
            }));
            this.bus.emit('compileStage', { stage: 'codegen', status: 'error', errors: this.errors });
            this.bus.emit('compileFailed', { errors: this.errors });
            return { success: false, errors: this.errors };
        }
        this.bus.emit('compileStage', { stage: 'codegen', status: 'done', assembly: this.assembly });

        // Stage 5: Assembly (using engine's assembler)
        this.bus.emit('compileStage', { stage: 'assembler', status: 'running' });
        const assembler = new window.MiniCPU.Assembler(this.bus);
        const asmResult = assembler.assemble(this.assembly);

        if (asmResult.errors.length > 0) {
            this.errors = asmResult.errors.map(e => ({
                stage: 'assembler',
                ...e
            }));
            this.bus.emit('compileStage', { stage: 'assembler', status: 'error', errors: this.errors });
            this.bus.emit('compileFailed', { errors: this.errors });
            return { success: false, errors: this.errors };
        }

        this.bytecode = asmResult.bytes;
        this.listing = asmResult.listing;
        this.labels = asmResult.labels;
        this.bus.emit('compileStage', { stage: 'assembler', status: 'done', listing: this.listing });

        // Compilation successful
        this.bus.emit('compileSuccess', {
            bytecode: this.bytecode,
            listing: this.listing,
            tokens: this.tokens,
            ast: this.ast,
            assembly: this.assembly,
            labels: this.labels,
            symbols: Object.fromEntries(this.generator.symbols),
            programSize: this.bytecode.length
        });

        return {
            success: true,
            errors: [],
            bytecode: this.bytecode,
            listing: this.listing,
            ast: this.ast,
            tokens: this.tokens,
            assembly: this.assembly,
            symbols: this.generator.symbols,
            labels: this.labels
        };
    }
}


// ============================================================================
// Exports
// ============================================================================

window.MiniCompiler = {
    Lexer,
    Parser,
    SemanticAnalyzer,
    CodeGenerator,
    Compiler,
    Token,
    TokenType,
    ASTNodeType,
    KEYWORDS,
};
