// ============================================================================
// compiler.js — MiniCPU 32-bit Compiler
// ============================================================================
// Compiles C-like code to MiniCPU 32-bit assembly
// Supports: #include, main(), printf(), for, while, if/else, return, int
// ============================================================================

'use strict';

// ============================================================================
// Token Types
// ============================================================================

const TokenType = {
    // Literals
    NUMBER:     'NUMBER',
    STRING:     'STRING',
    IDENTIFIER: 'IDENTIFIER',
    // Keywords
    INT:        'INT',
    VOID:       'VOID',
    CHAR:       'CHAR',
    IF:         'IF',
    ELSE:       'ELSE',
    WHILE:      'WHILE',
    FOR:        'FOR',
    RETURN:     'RETURN',
    PRINTF:     'PRINTF',
    // Operators
    PLUS:       'PLUS',
    MINUS:      'MINUS',
    STAR:       'STAR',
    SLASH:      'SLASH',
    PERCENT:    'PERCENT',
    // Logical
    AND_AND:    'AND_AND',   // &&
    OR_OR:      'OR_OR',     // ||
    BANG:       'BANG',      // !
    // Bitwise
    AMP:        'AMP',       // &
    PIPE:       'PIPE',      // |
    CARET:      'CARET',     // ^
    TILDE:      'TILDE',     // ~
    // Assignment
    ASSIGN:     'ASSIGN',
    PLUS_EQ:    'PLUS_EQ',   // +=
    MINUS_EQ:   'MINUS_EQ',  // -=
    STAR_EQ:    'STAR_EQ',   // *=
    SLASH_EQ:   'SLASH_EQ',  // /=
    PERCENT_EQ: 'PERCENT_EQ', // %=
    PLUS_PLUS:  'PLUS_PLUS', // ++
    MINUS_MINUS:'MINUS_MINUS', // --
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
    LBRACKET:   'LBRACKET',  // [
    RBRACKET:   'RBRACKET',  // ]
    SEMICOLON:  'SEMICOLON',
    COMMA:      'COMMA',
    // Preprocessor
    HASH:       'HASH',      // #
    // Special
    EOF:        'EOF',
    ERROR:      'ERROR',
};

const KEYWORDS = {
    'int':    TokenType.INT,
    'void':   TokenType.VOID,
    'char':   TokenType.CHAR,
    'if':     TokenType.IF,
    'else':   TokenType.ELSE,
    'while':  TokenType.WHILE,
    'for':    TokenType.FOR,
    'return': TokenType.RETURN,
    'printf': TokenType.PRINTF,
};

// Token class
class Token {
    constructor(type, value, line, col, raw = null) {
        this.type = type;
        this.value = value;
        this.line = line;
        this.col = col;
        this.raw = raw || String(value);
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
        this._steps = [];
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

            // Skip multi-line comments
            if (ch === '/' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '*') {
                this._advance(); this._advance(); // skip /*
                while (this.pos < this.source.length) {
                    if (this.source[this.pos] === '*' && this.pos + 1 < this.source.length && this.source[this.pos + 1] === '/') {
                        this._advance(); this._advance();
                        break;
                    }
                    this._advance();
                }
                continue;
            }

            // Preprocessor directives (#include)
            if (ch === '#') {
                const token = this._readPreprocessor(startLine, startCol);
                if (token) {
                    // Don't push preprocessor to tokens — just note it was seen
                    this._steps.push({
                        action: 'token',
                        token: new Token(TokenType.HASH, token, startLine, startCol, token),
                        charRange: [startPos, this.pos],
                        highlight: `Preprocessor: ${token} (recognized)`
                    });
                }
                continue;
            }

            // String literals
            if (ch === '"') {
                const token = this._readString(startLine, startCol);
                this.tokens.push(token);
                this._steps.push({
                    action: 'token',
                    token: token,
                    charRange: [startPos, this.pos],
                    highlight: `Recognized string literal`
                });
                continue;
            }

            // Character literals
            if (ch === "'") {
                const token = this._readCharLiteral(startLine, startCol);
                this.tokens.push(token);
                this._steps.push({
                    action: 'token',
                    token: token,
                    charRange: [startPos, this.pos],
                    highlight: `Recognized char literal`
                });
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
                    this._advance();
                    if (this.pos < this.source.length && this.source[this.pos] === '+') {
                        token = new Token(TokenType.PLUS_PLUS, '++', startLine, startCol, '++');
                        this._advance();
                    } else if (this.pos < this.source.length && this.source[this.pos] === '=') {
                        token = new Token(TokenType.PLUS_EQ, '+=', startLine, startCol, '+=');
                        this._advance();
                    } else {
                        token = new Token(TokenType.PLUS, '+', startLine, startCol);
                    }
                    break;
                case '-':
                    this._advance();
                    if (this.pos < this.source.length && this.source[this.pos] === '-') {
                        token = new Token(TokenType.MINUS_MINUS, '--', startLine, startCol, '--');
                        this._advance();
                    } else if (this.pos < this.source.length && this.source[this.pos] === '=') {
                        token = new Token(TokenType.MINUS_EQ, '-=', startLine, startCol, '-=');
                        this._advance();
                    } else {
                        token = new Token(TokenType.MINUS, '-', startLine, startCol);
                    }
                    break;
                case '*':
                    this._advance();
                    if (this.pos < this.source.length && this.source[this.pos] === '=') {
                        token = new Token(TokenType.STAR_EQ, '*=', startLine, startCol, '*=');
                        this._advance();
                    } else {
                        token = new Token(TokenType.STAR, '*', startLine, startCol);
                    }
                    break;
                case '/':
                    this._advance();
                    if (this.pos < this.source.length && this.source[this.pos] === '=') {
                        token = new Token(TokenType.SLASH_EQ, '/=', startLine, startCol, '/=');
                        this._advance();
                    } else {
                        token = new Token(TokenType.SLASH, '/', startLine, startCol);
                    }
                    break;
                case '%':
                    this._advance();
                    if (this.pos < this.source.length && this.source[this.pos] === '=') {
                        token = new Token(TokenType.PERCENT_EQ, '%=', startLine, startCol, '%=');
                        this._advance();
                    } else {
                        token = new Token(TokenType.PERCENT, '%', startLine, startCol);
                    }
                    break;
                case '&':
                    this._advance();
                    if (this.pos < this.source.length && this.source[this.pos] === '&') {
                        token = new Token(TokenType.AND_AND, '&&', startLine, startCol, '&&');
                        this._advance();
                    } else {
                        token = new Token(TokenType.AMP, '&', startLine, startCol);
                    }
                    break;
                case '|':
                    this._advance();
                    if (this.pos < this.source.length && this.source[this.pos] === '|') {
                        token = new Token(TokenType.OR_OR, '||', startLine, startCol, '||');
                        this._advance();
                    } else {
                        token = new Token(TokenType.PIPE, '|', startLine, startCol);
                    }
                    break;
                case '^':
                    token = new Token(TokenType.CARET, '^', startLine, startCol);
                    this._advance();
                    break;
                case '~':
                    token = new Token(TokenType.TILDE, '~', startLine, startCol);
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
                        token = new Token(TokenType.BANG, '!', startLine, startCol);
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
                case '[':
                    token = new Token(TokenType.LBRACKET, '[', startLine, startCol);
                    this._advance();
                    break;
                case ']':
                    token = new Token(TokenType.RBRACKET, ']', startLine, startCol);
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
        // Hex
        if (this.source[this.pos] === '0' && this.pos + 1 < this.source.length &&
            (this.source[this.pos + 1] === 'x' || this.source[this.pos + 1] === 'X')) {
            value = '0x';
            this._advance(); this._advance();
            while (this.pos < this.source.length && /[0-9a-fA-F]/.test(this.source[this.pos])) {
                value += this.source[this.pos];
                this._advance();
            }
            return new Token(TokenType.NUMBER, parseInt(value, 16), startLine, startCol, value);
        }
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

    _readString(startLine, startCol) {
        this._advance(); // skip opening "
        let value = '';
        while (this.pos < this.source.length && this.source[this.pos] !== '"') {
            if (this.source[this.pos] === '\\' && this.pos + 1 < this.source.length) {
                this._advance();
                switch (this.source[this.pos]) {
                    case 'n': value += '\n'; break;
                    case 't': value += '\t'; break;
                    case '\\': value += '\\'; break;
                    case '"': value += '"'; break;
                    case '0': value += '\0'; break;
                    default: value += this.source[this.pos];
                }
            } else {
                value += this.source[this.pos];
            }
            this._advance();
        }
        if (this.pos < this.source.length) this._advance(); // skip closing "
        return new Token(TokenType.STRING, value, startLine, startCol, `"${value}"`);
    }

    _readCharLiteral(startLine, startCol) {
        this._advance(); // skip opening '
        let value = 0;
        if (this.pos < this.source.length) {
            if (this.source[this.pos] === '\\' && this.pos + 1 < this.source.length) {
                this._advance();
                switch (this.source[this.pos]) {
                    case 'n': value = 10; break;
                    case 't': value = 9; break;
                    case '\\': value = 92; break;
                    case '0': value = 0; break;
                    default: value = this.source[this.pos].charCodeAt(0);
                }
            } else {
                value = this.source[this.pos].charCodeAt(0);
            }
            this._advance();
        }
        if (this.pos < this.source.length && this.source[this.pos] === "'") this._advance();
        return new Token(TokenType.NUMBER, value, startLine, startCol, `'${String.fromCharCode(value)}'`);
    }

    _readPreprocessor(startLine, startCol) {
        // Read the entire preprocessor line
        let directive = '';
        while (this.pos < this.source.length && this.source[this.pos] !== '\n') {
            directive += this.source[this.pos];
            this._advance();
        }
        return directive.trim();
    }
}


// ============================================================================
// AST Node Types
// ============================================================================

const ASTNodeType = {
    PROGRAM:         'Program',
    FUNC_DECL:       'FunctionDecl',
    VAR_DECL:        'VarDecl',
    ASSIGNMENT:      'Assignment',
    COMPOUND_ASSIGN: 'CompoundAssign',
    IF_STMT:         'IfStatement',
    WHILE_STMT:      'WhileStatement',
    FOR_STMT:        'ForStatement',
    BLOCK:           'Block',
    RETURN_STMT:     'ReturnStatement',
    PRINTF_STMT:     'PrintfStatement',
    EXPR_STMT:       'ExpressionStatement',
    BINARY_EXPR:     'BinaryExpression',
    UNARY_EXPR:      'UnaryExpression',
    LOGICAL_EXPR:    'LogicalExpression',
    NUMBER_LITERAL:  'NumberLiteral',
    STRING_LITERAL:  'StringLiteral',
    IDENTIFIER:      'Identifier',
    INC_DEC:         'IncDec',
};


// ============================================================================
// Parser — Converts tokens to AST (C-like grammar)
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

        const declarations = [];

        while (!this._isAtEnd()) {
            try {
                const decl = this._parseTopLevel();
                if (decl) {
                    declarations.push(decl);
                    this._steps.push({
                        action: 'parsed',
                        node: decl,
                        highlight: `Parsed ${decl.type}`
                    });
                }
            } catch (e) {
                this.errors.push({ line: this._current().line, col: this._current().col, message: e.message });
                this._synchronize();
            }
        }

        const program = {
            type: ASTNodeType.PROGRAM,
            body: declarations,
            line: 1
        };

        return { ast: program, errors: this.errors, steps: this._steps };
    }

    // ─── Top-Level Parsing ──────────────────────────────────────────────
    _parseTopLevel() {
        const token = this._current();

        // Function declaration: int main() { ... } or void func() { ... }
        if (token.type === TokenType.INT || token.type === TokenType.VOID) {
            // Look ahead: if next is identifier and then '(', it's a function
            if (this.pos + 1 < this.tokens.length &&
                this.tokens[this.pos + 1].type === TokenType.IDENTIFIER &&
                this.pos + 2 < this.tokens.length &&
                this.tokens[this.pos + 2].type === TokenType.LPAREN) {
                return this._parseFunctionDecl();
            }
            // Otherwise it's a global variable
            return this._parseVarDecl();
        }

        // If we see an identifier at top level, try statement
        return this._parseStatement();
    }

    _parseFunctionDecl() {
        const line = this._current().line;
        const returnType = this._advance().value; // int or void
        const name = this._expect(TokenType.IDENTIFIER).value;
        this._expect(TokenType.LPAREN);

        // Parse parameters (simple: no params for now)
        const params = [];
        if (!this._check(TokenType.RPAREN)) {
            // For now accept but ignore params
            while (!this._check(TokenType.RPAREN) && !this._isAtEnd()) {
                this._advance();
            }
        }
        this._expect(TokenType.RPAREN);

        const body = this._parseBlock();

        return {
            type: ASTNodeType.FUNC_DECL,
            name,
            returnType,
            params,
            body,
            line
        };
    }

    // ─── Statement Parsing ──────────────────────────────────────────────
    _parseStatement() {
        const token = this._current();

        switch (token.type) {
            case TokenType.INT:
            case TokenType.CHAR:
                return this._parseVarDecl();
            case TokenType.IF:
                return this._parseIfStatement();
            case TokenType.WHILE:
                return this._parseWhileStatement();
            case TokenType.FOR:
                return this._parseForStatement();
            case TokenType.PRINTF:
                return this._parsePrintfStatement();
            case TokenType.RETURN:
                return this._parseReturnStatement();
            case TokenType.LBRACE:
                return this._parseBlock();
            case TokenType.IDENTIFIER:
                return this._parseIdentifierStatement();
            default:
                throw new Error(`Unexpected token: ${token.type} "${token.value}"`);
        }
    }

    _parseVarDecl() {
        const line = this._current().line;
        this._advance(); // consume type keyword (int/char)
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

    _parseIdentifierStatement() {
        const line = this._current().line;
        const name = this._expect(TokenType.IDENTIFIER).value;

        // Check for assignment
        if (this._check(TokenType.ASSIGN)) {
            this._advance();
            const value = this._parseExpression();
            this._expect(TokenType.SEMICOLON);
            return {
                type: ASTNodeType.ASSIGNMENT,
                name,
                value,
                line
            };
        }

        // Compound assignment: +=, -=, *=, /=, %=
        if (this._check(TokenType.PLUS_EQ) || this._check(TokenType.MINUS_EQ) ||
            this._check(TokenType.STAR_EQ) || this._check(TokenType.SLASH_EQ) ||
            this._check(TokenType.PERCENT_EQ)) {
            const op = this._advance().value;
            const value = this._parseExpression();
            this._expect(TokenType.SEMICOLON);
            return {
                type: ASTNodeType.COMPOUND_ASSIGN,
                name,
                operator: op,
                value,
                line
            };
        }

        // ++ or --
        if (this._check(TokenType.PLUS_PLUS) || this._check(TokenType.MINUS_MINUS)) {
            const op = this._advance().value;
            this._expect(TokenType.SEMICOLON);
            return {
                type: ASTNodeType.INC_DEC,
                name,
                operator: op,
                line
            };
        }

        throw new Error(`Expected assignment or operation after '${name}'`);
    }

    _parseIfStatement() {
        const line = this._current().line;
        this._expect(TokenType.IF);
        this._expect(TokenType.LPAREN);
        const condition = this._parseExpression();
        this._expect(TokenType.RPAREN);

        const consequent = this._check(TokenType.LBRACE) ? this._parseBlock() : this._parseSingleStatementBlock();

        let alternate = null;
        if (this._check(TokenType.ELSE)) {
            this._advance();
            if (this._check(TokenType.IF)) {
                alternate = this._parseIfStatement();
            } else {
                alternate = this._check(TokenType.LBRACE) ? this._parseBlock() : this._parseSingleStatementBlock();
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
        const body = this._check(TokenType.LBRACE) ? this._parseBlock() : this._parseSingleStatementBlock();

        return {
            type: ASTNodeType.WHILE_STMT,
            condition,
            body,
            line
        };
    }

    _parseForStatement() {
        const line = this._current().line;
        this._expect(TokenType.FOR);
        this._expect(TokenType.LPAREN);

        // Init: can be a declaration or assignment or empty
        let init = null;
        if (!this._check(TokenType.SEMICOLON)) {
            if (this._check(TokenType.INT) || this._check(TokenType.CHAR)) {
                // Variable declaration (but without trailing semicolon — _parseVarDecl expects it)
                init = this._parseVarDecl();
                // _parseVarDecl already consumed the semicolon
            } else {
                const name = this._expect(TokenType.IDENTIFIER).value;
                this._expect(TokenType.ASSIGN);
                const value = this._parseExpression();
                this._expect(TokenType.SEMICOLON);
                init = { type: ASTNodeType.ASSIGNMENT, name, value, line };
            }
        } else {
            this._expect(TokenType.SEMICOLON);
        }

        // Condition
        let condition = null;
        if (!this._check(TokenType.SEMICOLON)) {
            condition = this._parseExpression();
        }
        this._expect(TokenType.SEMICOLON);

        // Update
        let update = null;
        if (!this._check(TokenType.RPAREN)) {
            const uName = this._expect(TokenType.IDENTIFIER).value;
            if (this._check(TokenType.ASSIGN)) {
                this._advance();
                const uValue = this._parseExpression();
                update = { type: ASTNodeType.ASSIGNMENT, name: uName, value: uValue, line };
            } else if (this._check(TokenType.PLUS_PLUS) || this._check(TokenType.MINUS_MINUS)) {
                const op = this._advance().value;
                update = { type: ASTNodeType.INC_DEC, name: uName, operator: op, line };
            } else if (this._check(TokenType.PLUS_EQ) || this._check(TokenType.MINUS_EQ) ||
                       this._check(TokenType.STAR_EQ) || this._check(TokenType.SLASH_EQ) ||
                       this._check(TokenType.PERCENT_EQ)) {
                const op = this._advance().value;
                const value = this._parseExpression();
                update = { type: ASTNodeType.COMPOUND_ASSIGN, name: uName, operator: op, value, line };
            }
        }
        this._expect(TokenType.RPAREN);

        const body = this._check(TokenType.LBRACE) ? this._parseBlock() : this._parseSingleStatementBlock();

        return {
            type: ASTNodeType.FOR_STMT,
            init,
            condition,
            update,
            body,
            line
        };
    }

    _parsePrintfStatement() {
        const line = this._current().line;
        this._expect(TokenType.PRINTF);
        this._expect(TokenType.LPAREN);

        // First argument must be a string
        const format = this._expect(TokenType.STRING);

        // Collect additional arguments
        const args = [];
        while (this._check(TokenType.COMMA)) {
            this._advance();
            args.push(this._parseExpression());
        }

        this._expect(TokenType.RPAREN);
        this._expect(TokenType.SEMICOLON);

        return {
            type: ASTNodeType.PRINTF_STMT,
            format: format.value,
            args,
            line
        };
    }

    _parseReturnStatement() {
        const line = this._current().line;
        this._expect(TokenType.RETURN);

        let value = null;
        if (!this._check(TokenType.SEMICOLON)) {
            value = this._parseExpression();
        }

        this._expect(TokenType.SEMICOLON);

        return {
            type: ASTNodeType.RETURN_STMT,
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

    _parseSingleStatementBlock() {
        const stmt = this._parseStatement();
        return {
            type: ASTNodeType.BLOCK,
            body: stmt ? [stmt] : [],
            line: stmt ? stmt.line : 0
        };
    }

    // ─── Expression Parsing (Precedence Climbing) ───────────────────────

    _parseExpression() {
        return this._parseLogicalOr();
    }

    _parseLogicalOr() {
        let left = this._parseLogicalAnd();
        while (this._check(TokenType.OR_OR)) {
            const op = this._advance();
            const right = this._parseLogicalAnd();
            left = {
                type: ASTNodeType.LOGICAL_EXPR,
                operator: '||',
                left,
                right,
                line: op.line
            };
        }
        return left;
    }

    _parseLogicalAnd() {
        let left = this._parseComparison();
        while (this._check(TokenType.AND_AND)) {
            const op = this._advance();
            const right = this._parseComparison();
            left = {
                type: ASTNodeType.LOGICAL_EXPR,
                operator: '&&',
                left,
                right,
                line: op.line
            };
        }
        return left;
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
        let left = this._parseMulDivMod();

        while (this._check(TokenType.PLUS) || this._check(TokenType.MINUS)) {
            const op = this._advance();
            const right = this._parseMulDivMod();
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

    _parseMulDivMod() {
        let left = this._parseUnary();

        while (this._check(TokenType.STAR) || this._check(TokenType.SLASH) || this._check(TokenType.PERCENT)) {
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
            const operand = this._parseUnary();
            return {
                type: ASTNodeType.UNARY_EXPR,
                operator: '-',
                operand,
                line: op.line
            };
        }
        if (this._check(TokenType.BANG)) {
            const op = this._advance();
            const operand = this._parseUnary();
            return {
                type: ASTNodeType.UNARY_EXPR,
                operator: '!',
                operand,
                line: op.line
            };
        }
        if (this._check(TokenType.TILDE)) {
            const op = this._advance();
            const operand = this._parseUnary();
            return {
                type: ASTNodeType.UNARY_EXPR,
                operator: '~',
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

        if (token.type === TokenType.STRING) {
            this._advance();
            return {
                type: ASTNodeType.STRING_LITERAL,
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
        while (!this._isAtEnd()) {
            if (this._current().type === TokenType.SEMICOLON) {
                this._advance();
                return;
            }
            if (this._current().type === TokenType.RBRACE) {
                return;
            }
            const nextType = this._current().type;
            if (nextType === TokenType.INT || nextType === TokenType.VOID ||
                nextType === TokenType.IF || nextType === TokenType.WHILE ||
                nextType === TokenType.FOR || nextType === TokenType.RETURN) {
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
        this.symbols = new Map();
    }

    analyze(ast) {
        this.errors = [];
        this.warnings = [];
        this.symbols = new Map();

        if (ast.type === ASTNodeType.PROGRAM) {
            for (const decl of ast.body) {
                if (decl.type === ASTNodeType.FUNC_DECL) {
                    this._analyzeFunctionBody(decl.body);
                } else {
                    this._analyzeStatement(decl);
                }
            }
        }

        return { errors: this.errors, warnings: this.warnings, symbols: this.symbols };
    }

    _analyzeFunctionBody(node) {
        if (node.type === ASTNodeType.BLOCK) {
            for (const s of node.body) {
                this._analyzeStatement(s);
            }
        }
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

            case ASTNodeType.COMPOUND_ASSIGN:
                if (!this.symbols.has(node.name)) {
                    this.errors.push({ line: node.line, message: `Variable '${node.name}' not declared` });
                }
                this._analyzeExpression(node.value);
                break;

            case ASTNodeType.INC_DEC:
                if (!this.symbols.has(node.name)) {
                    this.errors.push({ line: node.line, message: `Variable '${node.name}' not declared` });
                }
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

            case ASTNodeType.FOR_STMT:
                if (node.init) this._analyzeStatement(node.init);
                if (node.condition) this._analyzeExpression(node.condition);
                if (node.update) this._analyzeStatement(node.update);
                this._analyzeBody(node.body);
                break;

            case ASTNodeType.PRINTF_STMT:
                for (const arg of node.args) {
                    this._analyzeExpression(arg);
                }
                break;

            case ASTNodeType.RETURN_STMT:
                if (node.value) this._analyzeExpression(node.value);
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
                break;

            case ASTNodeType.STRING_LITERAL:
                break;

            case ASTNodeType.IDENTIFIER:
                if (!this.symbols.has(node.name)) {
                    this.errors.push({ line: node.line, message: `Variable '${node.name}' not declared` });
                }
                break;

            case ASTNodeType.BINARY_EXPR:
            case ASTNodeType.LOGICAL_EXPR:
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
// Code Generator — Compiles AST to MiniCPU 32-bit assembly instructions
// ============================================================================

class CodeGenerator {
    constructor() {
        this.instructions = [];
        this.symbols = new Map();      // varName -> memAddress
        this.strings = [];             // { addr, bytes } for string data
        this.nextDataAddr = window.MiniCPU ? window.MiniCPU.DATA_START : 0x800;
        this.labelCounter = 0;
        this.errors = [];
        this._sourceMap = [];
    }

    generate(ast) {
        this.instructions = [];
        this.symbols = new Map();
        this.strings = [];
        this.nextDataAddr = window.MiniCPU ? window.MiniCPU.DATA_START : 0x800;
        this.labelCounter = 0;
        this.errors = [];
        this._sourceMap = [];

        if (ast.type === ASTNodeType.PROGRAM) {
            // Look for main() function
            let hasMain = false;
            for (const decl of ast.body) {
                if (decl.type === ASTNodeType.FUNC_DECL && decl.name === 'main') {
                    hasMain = true;
                    this._generateBody(decl.body);
                } else if (decl.type !== ASTNodeType.FUNC_DECL) {
                    // Top-level statement (for backward compat)
                    this._generateStatement(decl);
                }
            }

            // If no main and we generated code, that's fine (backward compat)
        }

        // Add HLT at end
        this._emit('HLT', [], 0);

        return {
            instructions: this.instructions,
            errors: this.errors,
            symbols: this.symbols,
            strings: this.strings,
            sourceMap: this._sourceMap
        };
    }

    _newLabel() {
        return `_L${this.labelCounter++}`;
    }

    _allocVar(name) {
        if (this.symbols.has(name)) return this.symbols.get(name);
        const addr = this.nextDataAddr;
        if (addr > (window.MiniCPU ? window.MiniCPU.STACK_START : 0xFFC) - 64) {
            this.errors.push({ line: 0, message: `Out of data memory for variable '${name}'` });
            return 0;
        }
        this.symbols.set(name, addr);
        this.nextDataAddr += 4; // 32-bit word = 4 bytes
        return addr;
    }

    _allocString(str) {
        const addr = this.nextDataAddr;
        const bytes = [];
        for (let i = 0; i < str.length; i++) {
            bytes.push(str.charCodeAt(i));
        }
        bytes.push(0); // null terminator
        // Align to 4-byte boundary
        while (bytes.length % 4 !== 0) bytes.push(0);
        this.strings.push({ addr, bytes, value: str });
        this.nextDataAddr += bytes.length;
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
            case ASTNodeType.COMPOUND_ASSIGN:
                this._genCompoundAssign(node);
                break;
            case ASTNodeType.INC_DEC:
                this._genIncDec(node);
                break;
            case ASTNodeType.IF_STMT:
                this._genIfStatement(node);
                break;
            case ASTNodeType.WHILE_STMT:
                this._genWhileStatement(node);
                break;
            case ASTNodeType.FOR_STMT:
                this._genForStatement(node);
                break;
            case ASTNodeType.PRINTF_STMT:
                this._genPrintfStatement(node);
                break;
            case ASTNodeType.RETURN_STMT:
                this._genReturnStatement(node);
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
            this._generateExpression(node.initializer, 0);
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

    _genCompoundAssign(node) {
        const addr = this.symbols.get(node.name);
        if (addr === undefined) {
            this.errors.push({ line: node.line, message: `Undefined variable '${node.name}'` });
            return;
        }
        // Load current value
        this._emit('LOAD', ['R0', `${addr}`], node.line);
        this._emit('PUSH', ['R0'], node.line);
        // Evaluate RHS
        this._generateExpression(node.value, 0);
        this._emit('MOV', ['R1', 'R0'], node.line);
        this._emit('POP', ['R0'], node.line);
        // Apply operation
        const opMap = { '+=': 'ADD', '-=': 'SUB', '*=': 'MUL', '/=': 'DIV', '%=': 'MOD' };
        const asmOp = opMap[node.operator];
        if (asmOp) {
            this._emit(asmOp, ['R0', 'R1'], node.line);
        }
        this._emit('STORE', ['R0', `${addr}`], node.line);
    }

    _genIncDec(node) {
        const addr = this.symbols.get(node.name);
        if (addr === undefined) {
            this.errors.push({ line: node.line, message: `Undefined variable '${node.name}'` });
            return;
        }
        this._emit('LOAD', ['R0', `${addr}`], node.line);
        if (node.operator === '++') {
            this._emit('INC', ['R0'], node.line);
        } else {
            this._emit('DEC', ['R0'], node.line);
        }
        this._emit('STORE', ['R0', `${addr}`], node.line);
    }

    _genIfStatement(node) {
        const elseLabel = this._newLabel();
        const endLabel = this._newLabel();

        this._generateCondition(node.condition, elseLabel);
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
        this._generateCondition(node.condition, endLabel);
        this._generateBody(node.body);
        this._emit('JMP', [startLabel], node.line);
        this._emitLabel(endLabel, node.line);
    }

    _genForStatement(node) {
        const startLabel = this._newLabel();
        const endLabel = this._newLabel();

        // Init
        if (node.init) {
            this._generateStatement(node.init);
        }

        this._emitLabel(startLabel, node.line);

        // Condition
        if (node.condition) {
            this._generateCondition(node.condition, endLabel);
        }

        // Body
        this._generateBody(node.body);

        // Update
        if (node.update) {
            this._generateStatement(node.update);
        }

        this._emit('JMP', [startLabel], node.line);
        this._emitLabel(endLabel, node.line);
    }

    _genPrintfStatement(node) {
        // Parse the format string and generate output calls
        const fmt = node.format;
        let argIdx = 0;
        let i = 0;

        while (i < fmt.length) {
            if (fmt[i] === '%' && i + 1 < fmt.length) {
                i++;
                switch (fmt[i]) {
                    case 'd':
                    case 'i': {
                        // Print integer argument
                        if (argIdx < node.args.length) {
                            this._generateExpression(node.args[argIdx], 0);
                            this._emit('SYSCALL', ['1'], node.line);  // Print integer from R0
                            argIdx++;
                        }
                        break;
                    }
                    case 'c': {
                        // Print character
                        if (argIdx < node.args.length) {
                            this._generateExpression(node.args[argIdx], 0);
                            this._emit('SYSCALL', ['3'], node.line);  // Print char from R0
                            argIdx++;
                        }
                        break;
                    }
                    case 's': {
                        // Print string (address in R0)
                        if (argIdx < node.args.length) {
                            this._generateExpression(node.args[argIdx], 0);
                            this._emit('SYSCALL', ['2'], node.line);  // Print string from R0
                            argIdx++;
                        }
                        break;
                    }
                    case '%':
                        // Literal %
                        this._emit('MOV', ['R0', `${37}`], node.line);  // '%' = 37
                        this._emit('SYSCALL', ['3'], node.line);
                        break;
                    default:
                        // Unknown format specifier, skip
                        break;
                }
                i++;
            } else if (fmt[i] === '\\' && i + 1 < fmt.length && fmt[i + 1] === 'n') {
                // Literal \n in format string
                this._emit('SYSCALL', ['4'], node.line);  // Print newline
                i += 2;
            } else if (fmt[i] === '\n') {
                // Actual newline character
                this._emit('SYSCALL', ['4'], node.line);
                i++;
            } else {
                // Literal character
                this._emit('MOV', ['R0', `${fmt.charCodeAt(i)}`], node.line);
                this._emit('SYSCALL', ['3'], node.line);
                i++;
            }
        }
    }

    _genReturnStatement(node) {
        if (node.value) {
            this._generateExpression(node.value, 0);
        } else {
            this._emit('MOV', ['R0', '0'], node.line);
        }
        this._emit('HLT', [], node.line);
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

    _generateExpression(node, dest) {
        switch (node.type) {
            case ASTNodeType.NUMBER_LITERAL:
                this._emit('MOV', [`R${dest}`, `${node.value}`], node.line);
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

            case ASTNodeType.STRING_LITERAL: {
                const addr = this._allocString(node.value);
                this._emit('MOV', [`R${dest}`, `${addr}`], node.line);
                break;
            }

            case ASTNodeType.UNARY_EXPR:
                if (node.operator === '-') {
                    this._generateExpression(node.operand, dest);
                    this._emit('NEG', [`R${dest}`], node.line);
                } else if (node.operator === '!') {
                    this._generateExpression(node.operand, dest);
                    // Logical NOT: if 0 -> 1, else -> 0
                    this._emit('CMP', [`R${dest}`, '0'], node.line);
                    const oneLabel = this._newLabel();
                    const endLabel = this._newLabel();
                    this._emit('JZ', [oneLabel], node.line);
                    this._emit('MOV', [`R${dest}`, '0'], node.line);
                    this._emit('JMP', [endLabel], node.line);
                    this._emitLabel(oneLabel, node.line);
                    this._emit('MOV', [`R${dest}`, '1'], node.line);
                    this._emitLabel(endLabel, node.line);
                } else if (node.operator === '~') {
                    this._generateExpression(node.operand, dest);
                    this._emit('NOT', [`R${dest}`], node.line);
                }
                break;

            case ASTNodeType.BINARY_EXPR:
                this._genBinaryExpr(node, dest);
                break;

            case ASTNodeType.LOGICAL_EXPR:
                this._genLogicalExpr(node, dest);
                break;
        }
    }

    _genBinaryExpr(node, dest) {
        const op = node.operator;

        if (['+', '-', '*', '/', '%'].includes(op)) {
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
            const opMap = { '+': 'ADD', '-': 'SUB', '*': 'MUL', '/': 'DIV', '%': 'MOD' };
            this._emit(opMap[op], ['R0', 'R1'], node.line);

            // Move result to destination if needed
            if (dest !== 0) {
                this._emit('MOV', [`R${dest}`, 'R0'], node.line);
            }
        }
    }

    _genLogicalExpr(node, dest) {
        if (node.operator === '&&') {
            const falseLabel = this._newLabel();
            const endLabel = this._newLabel();
            // Eval left
            this._generateExpression(node.left, 0);
            this._emit('CMP', ['R0', '0'], node.line);
            this._emit('JZ', [falseLabel], node.line);
            // Eval right
            this._generateExpression(node.right, 0);
            this._emit('CMP', ['R0', '0'], node.line);
            this._emit('JZ', [falseLabel], node.line);
            this._emit('MOV', [`R${dest}`, '1'], node.line);
            this._emit('JMP', [endLabel], node.line);
            this._emitLabel(falseLabel, node.line);
            this._emit('MOV', [`R${dest}`, '0'], node.line);
            this._emitLabel(endLabel, node.line);
        } else if (node.operator === '||') {
            const trueLabel = this._newLabel();
            const endLabel = this._newLabel();
            // Eval left
            this._generateExpression(node.left, 0);
            this._emit('CMP', ['R0', '0'], node.line);
            this._emit('JNZ', [trueLabel], node.line);
            // Eval right
            this._generateExpression(node.right, 0);
            this._emit('CMP', ['R0', '0'], node.line);
            this._emit('JNZ', [trueLabel], node.line);
            this._emit('MOV', [`R${dest}`, '0'], node.line);
            this._emit('JMP', [endLabel], node.line);
            this._emitLabel(trueLabel, node.line);
            this._emit('MOV', [`R${dest}`, '1'], node.line);
            this._emitLabel(endLabel, node.line);
        }
    }

    // ─── Condition Generation ───────────────────────────────────────────

    _generateCondition(node, falseLabel) {
        if (node.type === ASTNodeType.BINARY_EXPR &&
            ['==', '!=', '<', '>', '<=', '>='].includes(node.operator)) {

            this._generateExpression(node.left, 0);
            this._emit('PUSH', ['R0'], node.line);
            this._generateExpression(node.right, 0);
            this._emit('MOV', ['R1', 'R0'], node.line);
            this._emit('POP', ['R0'], node.line);
            this._emit('CMP', ['R0', 'R1'], node.line);

            switch (node.operator) {
                case '==': this._emit('JNZ', [falseLabel], node.line); break;
                case '!=': this._emit('JZ',  [falseLabel], node.line); break;
                case '<':  this._emit('JGE', [falseLabel], node.line); break;
                case '>':  this._emit('JLE', [falseLabel], node.line); break;
                case '<=': this._emit('JG',  [falseLabel], node.line); break;
                case '>=': this._emit('JL',  [falseLabel], node.line); break;
            }
        } else if (node.type === ASTNodeType.LOGICAL_EXPR) {
            if (node.operator === '&&') {
                this._generateCondition(node.left, falseLabel);
                this._generateCondition(node.right, falseLabel);
            } else if (node.operator === '||') {
                const trueLabel = this._newLabel();
                // Invert: jump to trueLabel if left is true
                this._generateExpression(node.left, 0);
                this._emit('CMP', ['R0', '0'], node.line);
                this._emit('JNZ', [trueLabel], node.line);
                // Left was false, check right
                this._generateCondition(node.right, falseLabel);
                this._emitLabel(trueLabel, node.line);
            }
        } else {
            // Treat as truthy/falsy
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
            this.errors = lexResult.errors.map(e => ({ stage: 'lexer', ...e }));
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
            this.errors = parseResult.errors.map(e => ({ stage: 'parser', ...e }));
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
            this.errors = semResult.errors.map(e => ({ stage: 'semantic', ...e }));
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
            this.errors = genResult.errors.map(e => ({ stage: 'codegen', ...e }));
            this.bus.emit('compileStage', { stage: 'codegen', status: 'error', errors: this.errors });
            this.bus.emit('compileFailed', { errors: this.errors });
            return { success: false, errors: this.errors };
        }
        this.bus.emit('compileStage', { stage: 'codegen', status: 'done', assembly: this.assembly });

        // Stage 5: Assembly
        this.bus.emit('compileStage', { stage: 'assembler', status: 'running' });
        const assembler = new window.MiniCPU.Assembler(this.bus);
        const asmResult = assembler.assemble(this.assembly);

        if (asmResult.errors.length > 0) {
            this.errors = asmResult.errors.map(e => ({ stage: 'assembler', ...e }));
            this.bus.emit('compileStage', { stage: 'assembler', status: 'error', errors: this.errors });
            this.bus.emit('compileFailed', { errors: this.errors });
            return { success: false, errors: this.errors };
        }

        this.bytecode = asmResult.bytes;
        this.listing = asmResult.listing;
        this.labels = asmResult.labels;

        // Also load string data into bytecode
        const stringData = genResult.strings || [];

        this.bus.emit('compileStage', { stage: 'assembler', status: 'done', listing: this.listing });

        this.bus.emit('compileSuccess', {
            bytecode: this.bytecode,
            listing: this.listing,
            tokens: this.tokens,
            ast: this.ast,
            assembly: this.assembly,
            labels: this.labels,
            symbols: Object.fromEntries(this.generator.symbols),
            strings: stringData,
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
            strings: stringData,
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
