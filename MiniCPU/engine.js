// ============================================================================
// engine.js — MiniCPU Hardware Engine
// ============================================================================
// Contains: EventBus, Memory, Registers, Flags, ALU, Stack, InstructionSet,
//           Assembler, Loader, CPU, Debugger
// ============================================================================

'use strict';

// ============================================================================
// EventBus — Decoupled communication between all components
// ============================================================================

class EventBus {
    constructor() {
        this._listeners = new Map();
        this._history = [];
        this._maxHistory = 1000;
    }

    on(event, callback, context = null) {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, []);
        }
        const entry = { callback, context };
        this._listeners.get(event).push(entry);
        // Return unsubscribe function
        return () => {
            const list = this._listeners.get(event);
            if (list) {
                const idx = list.indexOf(entry);
                if (idx !== -1) list.splice(idx, 1);
            }
        };
    }

    off(event, callback) {
        const list = this._listeners.get(event);
        if (!list) return;
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].callback === callback) {
                list.splice(i, 1);
            }
        }
    }

    emit(event, data = {}) {
        const record = { event, data, timestamp: performance.now() };
        this._history.push(record);
        if (this._history.length > this._maxHistory) {
            this._history.shift();
        }
        const list = this._listeners.get(event);
        if (!list) return;
        // Copy to avoid mutation during iteration
        const snapshot = list.slice();
        for (const entry of snapshot) {
            try {
                entry.callback.call(entry.context, data);
            } catch (err) {
                console.error(`EventBus error in "${event}":`, err);
            }
        }
    }

    once(event, callback, context = null) {
        const unsub = this.on(event, (data) => {
            unsub();
            callback.call(context, data);
        });
        return unsub;
    }

    clear() {
        this._listeners.clear();
        this._history = [];
    }

    getHistory(event = null) {
        if (event) return this._history.filter(h => h.event === event);
        return this._history.slice();
    }
}

// ============================================================================
// Constants — ISA Definition
// ============================================================================

const MEMORY_SIZE = 256;       // 256 bytes addressable (0x00–0xFF)
const NUM_REGISTERS = 4;       // R0–R3
const STACK_START = 0xFF;      // Stack grows downward from 0xFF
const DATA_START = 0xC0;       // Data segment starts at 0xC0
const CODE_START = 0x00;       // Code segment starts at 0x00

// Opcodes — Version 1 (Core)
const OP = {
    NOP:    0x00,
    // Data Movement
    MOV_RR: 0x01,   // MOV Rd, Rs          — Rd = Rs
    MOV_RI: 0x02,   // MOV Rd, #imm8       — Rd = imm8
    LOAD:   0x03,   // LOAD Rd, [addr]     — Rd = mem[addr]
    STORE:  0x04,   // STORE Rs, [addr]    — mem[addr] = Rs
    LOAD_RR:0x05,   // LOAD Rd, [Rs]       — Rd = mem[Rs]
    STORE_RR:0x06,  // STORE Rs, [Rd]      — mem[Rd] = Rs
    // Arithmetic
    ADD_RR: 0x10,   // ADD Rd, Rs          — Rd = Rd + Rs
    ADD_RI: 0x11,   // ADD Rd, #imm8       — Rd = Rd + imm8
    SUB_RR: 0x12,   // SUB Rd, Rs          — Rd = Rd - Rs
    SUB_RI: 0x13,   // SUB Rd, #imm8       — Rd = Rd - imm8
    MUL_RR: 0x14,   // MUL Rd, Rs          — Rd = Rd * Rs
    MUL_RI: 0x15,   // MUL Rd, #imm8       — Rd = Rd * imm8
    INC:    0x16,   // INC Rd              — Rd = Rd + 1
    DEC:    0x17,   // DEC Rd              — Rd = Rd - 1
    // Logic
    AND_RR: 0x20,   // AND Rd, Rs          — Rd = Rd & Rs
    OR_RR:  0x21,   // OR  Rd, Rs          — Rd = Rd | Rs
    XOR_RR: 0x22,   // XOR Rd, Rs          — Rd = Rd ^ Rs
    NOT:    0x23,   // NOT Rd              — Rd = ~Rd
    SHL:    0x24,   // SHL Rd, #imm8       — Rd = Rd << imm8
    SHR:    0x25,   // SHR Rd, #imm8       — Rd = Rd >> imm8
    // Comparison
    CMP_RR: 0x30,   // CMP Rd, Rs          — flags = Rd - Rs
    CMP_RI: 0x31,   // CMP Rd, #imm8       — flags = Rd - imm8
    // Branching
    JMP:    0x40,   // JMP addr            — PC = addr
    JZ:     0x41,   // JZ  addr            — if ZF: PC = addr
    JNZ:    0x42,   // JNZ addr            — if !ZF: PC = addr
    JG:     0x43,   // JG  addr            — if !ZF && !NF: PC = addr
    JL:     0x44,   // JL  addr            — if NF: PC = addr
    JGE:    0x45,   // JGE addr            — if ZF || !NF: PC = addr
    JLE:    0x46,   // JLE addr            — if ZF || NF: PC = addr
    // Stack
    PUSH:   0x50,   // PUSH Rs             — mem[SP] = Rs; SP--
    POP:    0x51,   // POP  Rd             — SP++; Rd = mem[SP]
    PUSH_I: 0x52,   // PUSH #imm8          — mem[SP] = imm8; SP--
    // Subroutines
    CALL:   0x60,   // CALL addr           — push PC+2; PC = addr
    RET:    0x61,   // RET                 — pop PC
    // I/O
    OUT:    0x70,   // OUT Rs              — output Rs value
    OUT_I:  0x71,   // OUT #imm8           — output imm8
    // System
    HLT:    0xFF,   // HLT                 — halt CPU
};

// Reverse lookup: opcode number -> name
const OP_NAMES = {};
for (const [name, code] of Object.entries(OP)) {
    OP_NAMES[code] = name;
}

// Instruction format info: opcode -> { size, format, description }
const INSTRUCTION_SET = {
    [OP.NOP]:     { size: 1, format: 'none',    mnemonic: 'NOP',   desc: 'No operation' },
    [OP.MOV_RR]:  { size: 2, format: 'rr',      mnemonic: 'MOV',   desc: 'Copy register to register' },
    [OP.MOV_RI]:  { size: 3, format: 'ri',      mnemonic: 'MOV',   desc: 'Load immediate into register' },
    [OP.LOAD]:    { size: 3, format: 'ra',      mnemonic: 'LOAD',  desc: 'Load from memory address' },
    [OP.STORE]:   { size: 3, format: 'ra',      mnemonic: 'STORE', desc: 'Store to memory address' },
    [OP.LOAD_RR]: { size: 2, format: 'rr',      mnemonic: 'LOAD',  desc: 'Load from address in register' },
    [OP.STORE_RR]:{ size: 2, format: 'rr',      mnemonic: 'STORE', desc: 'Store to address in register' },
    [OP.ADD_RR]:  { size: 2, format: 'rr',      mnemonic: 'ADD',   desc: 'Add register to register' },
    [OP.ADD_RI]:  { size: 3, format: 'ri',      mnemonic: 'ADD',   desc: 'Add immediate to register' },
    [OP.SUB_RR]:  { size: 2, format: 'rr',      mnemonic: 'SUB',   desc: 'Subtract register from register' },
    [OP.SUB_RI]:  { size: 3, format: 'ri',      mnemonic: 'SUB',   desc: 'Subtract immediate from register' },
    [OP.MUL_RR]:  { size: 2, format: 'rr',      mnemonic: 'MUL',   desc: 'Multiply register by register' },
    [OP.MUL_RI]:  { size: 3, format: 'ri',      mnemonic: 'MUL',   desc: 'Multiply register by immediate' },
    [OP.INC]:     { size: 2, format: 'r',       mnemonic: 'INC',   desc: 'Increment register' },
    [OP.DEC]:     { size: 2, format: 'r',       mnemonic: 'DEC',   desc: 'Decrement register' },
    [OP.AND_RR]:  { size: 2, format: 'rr',      mnemonic: 'AND',   desc: 'Bitwise AND' },
    [OP.OR_RR]:   { size: 2, format: 'rr',      mnemonic: 'OR',    desc: 'Bitwise OR' },
    [OP.XOR_RR]:  { size: 2, format: 'rr',      mnemonic: 'XOR',   desc: 'Bitwise XOR' },
    [OP.NOT]:     { size: 2, format: 'r',       mnemonic: 'NOT',   desc: 'Bitwise NOT' },
    [OP.SHL]:     { size: 3, format: 'ri',      mnemonic: 'SHL',   desc: 'Shift left' },
    [OP.SHR]:     { size: 3, format: 'ri',      mnemonic: 'SHR',   desc: 'Shift right' },
    [OP.CMP_RR]:  { size: 2, format: 'rr',      mnemonic: 'CMP',   desc: 'Compare registers' },
    [OP.CMP_RI]:  { size: 3, format: 'ri',      mnemonic: 'CMP',   desc: 'Compare register with immediate' },
    [OP.JMP]:     { size: 2, format: 'addr',    mnemonic: 'JMP',   desc: 'Unconditional jump' },
    [OP.JZ]:      { size: 2, format: 'addr',    mnemonic: 'JZ',    desc: 'Jump if zero' },
    [OP.JNZ]:     { size: 2, format: 'addr',    mnemonic: 'JNZ',   desc: 'Jump if not zero' },
    [OP.JG]:      { size: 2, format: 'addr',    mnemonic: 'JG',    desc: 'Jump if greater' },
    [OP.JL]:      { size: 2, format: 'addr',    mnemonic: 'JL',    desc: 'Jump if less' },
    [OP.JGE]:     { size: 2, format: 'addr',    mnemonic: 'JGE',   desc: 'Jump if greater or equal' },
    [OP.JLE]:     { size: 2, format: 'addr',    mnemonic: 'JLE',   desc: 'Jump if less or equal' },
    [OP.PUSH]:    { size: 2, format: 'r',       mnemonic: 'PUSH',  desc: 'Push register onto stack' },
    [OP.POP]:     { size: 2, format: 'r',       mnemonic: 'POP',   desc: 'Pop stack into register' },
    [OP.PUSH_I]:  { size: 2, format: 'imm',     mnemonic: 'PUSH',  desc: 'Push immediate onto stack' },
    [OP.CALL]:    { size: 2, format: 'addr',    mnemonic: 'CALL',  desc: 'Call subroutine' },
    [OP.RET]:     { size: 1, format: 'none',    mnemonic: 'RET',   desc: 'Return from subroutine' },
    [OP.OUT]:     { size: 2, format: 'r',       mnemonic: 'OUT',   desc: 'Output register value' },
    [OP.OUT_I]:   { size: 2, format: 'imm',     mnemonic: 'OUT',   desc: 'Output immediate value' },
    [OP.HLT]:     { size: 1, format: 'none',    mnemonic: 'HLT',   desc: 'Halt CPU' },
};

// Register name mapping
const REG_NAMES = ['R0', 'R1', 'R2', 'R3'];


// ============================================================================
// Memory — Observable memory with event emission
// ============================================================================

class Memory {
    constructor(bus, size = MEMORY_SIZE) {
        this.bus = bus;
        this.size = size;
        this.data = new Uint8Array(size);
        this._regions = {
            code:  { start: CODE_START, end: DATA_START - 1, label: 'Code' },
            data:  { start: DATA_START, end: STACK_START - 16, label: 'Data' },
            stack: { start: STACK_START - 15, end: STACK_START, label: 'Stack' },
        };
    }

    read(address) {
        if (address < 0 || address >= this.size) {
            this.bus.emit('error', { type: 'memory', message: `Read out of bounds: 0x${address.toString(16).toUpperCase()}` });
            return 0;
        }
        this.bus.emit('memoryRead', { address, value: this.data[address] });
        return this.data[address];
    }

    write(address, value) {
        if (address < 0 || address >= this.size) {
            this.bus.emit('error', { type: 'memory', message: `Write out of bounds: 0x${address.toString(16).toUpperCase()}` });
            return;
        }
        const oldValue = this.data[address];
        this.data[address] = value & 0xFF;
        this.bus.emit('memoryWrite', { address, value: this.data[address], oldValue });
    }

    // Read without emitting events (for visualization)
    peek(address) {
        if (address < 0 || address >= this.size) return 0;
        return this.data[address];
    }

    // Write without emitting events (for loading programs)
    poke(address, value) {
        if (address < 0 || address >= this.size) return;
        this.data[address] = value & 0xFF;
    }

    // Load a program (array of bytes) starting at an address
    loadProgram(bytes, startAddress = CODE_START) {
        for (let i = 0; i < bytes.length; i++) {
            this.poke(startAddress + i, bytes[i]);
        }
        this.bus.emit('programLoaded', {
            startAddress,
            length: bytes.length,
            endAddress: startAddress + bytes.length - 1
        });
    }

    // Clear all memory
    clear() {
        this.data.fill(0);
        this.bus.emit('memoryCleared', {});
    }

    // Get a snapshot of memory
    snapshot() {
        return new Uint8Array(this.data);
    }

    // Restore from snapshot
    restore(snap) {
        this.data.set(snap);
    }

    // Get region info for an address
    getRegion(address) {
        for (const [key, region] of Object.entries(this._regions)) {
            if (address >= region.start && address <= region.end) {
                return { key, ...region };
            }
        }
        return { key: 'unknown', start: 0, end: this.size - 1, label: 'Unknown' };
    }

    get regions() {
        return this._regions;
    }
}


// ============================================================================
// Registers — Observable register file
// ============================================================================

class Registers {
    constructor(bus, count = NUM_REGISTERS) {
        this.bus = bus;
        this.count = count;
        this.data = new Int16Array(count); // Signed 16-bit for display, but we mask to 8-bit
        this._pc = 0;
        this._sp = STACK_START;
    }

    get(index) {
        if (index < 0 || index >= this.count) {
            this.bus.emit('error', { type: 'register', message: `Invalid register: R${index}` });
            return 0;
        }
        return this.data[index] & 0xFF;
    }

    set(index, value) {
        if (index < 0 || index >= this.count) {
            this.bus.emit('error', { type: 'register', message: `Invalid register: R${index}` });
            return;
        }
        const oldValue = this.data[index] & 0xFF;
        this.data[index] = value & 0xFF;
        this.bus.emit('registerChanged', {
            register: index,
            name: REG_NAMES[index],
            value: this.data[index] & 0xFF,
            oldValue
        });
    }

    // Program Counter
    get pc() { return this._pc; }
    set pc(value) {
        const oldValue = this._pc;
        this._pc = value & 0xFF;
        this.bus.emit('pcChanged', { value: this._pc, oldValue });
    }

    // Stack Pointer
    get sp() { return this._sp; }
    set sp(value) {
        const oldValue = this._sp;
        this._sp = value & 0xFF;
        this.bus.emit('spChanged', { value: this._sp, oldValue });
    }

    // Snapshot for debugger
    snapshot() {
        return {
            data: new Int16Array(this.data),
            pc: this._pc,
            sp: this._sp
        };
    }

    restore(snap) {
        this.data.set(snap.data);
        this._pc = snap.pc;
        this._sp = snap.sp;
    }

    reset() {
        this.data.fill(0);
        this._pc = 0;
        this._sp = STACK_START;
        this.bus.emit('registersReset', {});
    }
}


// ============================================================================
// Flags — CPU status flags
// ============================================================================

class Flags {
    constructor(bus) {
        this.bus = bus;
        this._zero = false;
        this._negative = false;
        this._carry = false;
        this._overflow = false;
    }

    get zero() { return this._zero; }
    set zero(v) {
        const old = this._zero;
        this._zero = !!v;
        if (old !== this._zero) this.bus.emit('flagChanged', { flag: 'Z', value: this._zero, oldValue: old });
    }

    get negative() { return this._negative; }
    set negative(v) {
        const old = this._negative;
        this._negative = !!v;
        if (old !== this._negative) this.bus.emit('flagChanged', { flag: 'N', value: this._negative, oldValue: old });
    }

    get carry() { return this._carry; }
    set carry(v) {
        const old = this._carry;
        this._carry = !!v;
        if (old !== this._carry) this.bus.emit('flagChanged', { flag: 'C', value: this._carry, oldValue: old });
    }

    get overflow() { return this._overflow; }
    set overflow(v) {
        const old = this._overflow;
        this._overflow = !!v;
        if (old !== this._overflow) this.bus.emit('flagChanged', { flag: 'V', value: this._overflow, oldValue: old });
    }

    // Update flags based on a result value (8-bit)
    update(result, a, b, isSub = false) {
        const r8 = result & 0xFF;
        this.zero = (r8 === 0);
        this.negative = !!(r8 & 0x80);
        if (isSub) {
            this.carry = (a < (b & 0xFF)); // borrow
            this.overflow = (((a ^ b) & 0x80) !== 0) && (((a ^ r8) & 0x80) !== 0);
        } else {
            this.carry = (result > 0xFF);
            this.overflow = (((~(a ^ b)) & (a ^ r8) & 0x80) !== 0);
        }
    }

    snapshot() {
        return {
            zero: this._zero,
            negative: this._negative,
            carry: this._carry,
            overflow: this._overflow
        };
    }

    restore(snap) {
        this._zero = snap.zero;
        this._negative = snap.negative;
        this._carry = snap.carry;
        this._overflow = snap.overflow;
    }

    reset() {
        this._zero = false;
        this._negative = false;
        this._carry = false;
        this._overflow = false;
        this.bus.emit('flagsReset', {});
    }

    toString() {
        return `[Z:${this._zero ? 1 : 0} N:${this._negative ? 1 : 0} C:${this._carry ? 1 : 0} V:${this._overflow ? 1 : 0}]`;
    }
}


// ============================================================================
// ALU — Arithmetic Logic Unit
// ============================================================================

class ALU {
    constructor(bus) {
        this.bus = bus;
    }

    execute(operation, a, b = 0) {
        let result;
        let isSub = false;

        switch (operation) {
            case 'ADD':
                result = (a + b);
                break;
            case 'SUB':
                result = (a - b);
                isSub = true;
                break;
            case 'MUL':
                result = (a * b);
                break;
            case 'AND':
                result = (a & b);
                break;
            case 'OR':
                result = (a | b);
                break;
            case 'XOR':
                result = (a ^ b);
                break;
            case 'NOT':
                result = (~a);
                break;
            case 'SHL':
                result = (a << b);
                break;
            case 'SHR':
                result = (a >>> b);
                break;
            case 'INC':
                result = (a + 1);
                break;
            case 'DEC':
                result = (a - 1);
                isSub = true;
                b = 1;
                break;
            case 'CMP':
                result = (a - b);
                isSub = true;
                break;
            case 'PASS':
                result = a;
                break;
            default:
                this.bus.emit('error', { type: 'alu', message: `Unknown ALU operation: ${operation}` });
                result = 0;
        }

        const result8 = result & 0xFF;

        this.bus.emit('aluOperation', {
            operation,
            operandA: a,
            operandB: b,
            result: result8,
            rawResult: result,
            isSub
        });

        return { result: result8, rawResult: result, isSub, a, b };
    }
}


// ============================================================================
// Assembler — Converts assembly text to machine code
// ============================================================================

class Assembler {
    constructor(bus) {
        this.bus = bus;
    }

    /**
     * Assemble an array of { mnemonic, operands, label?, sourceLine? } objects
     * into machine code bytes.
     * Returns { bytes, listing, errors, labels }
     */
    assemble(instructions) {
        const errors = [];
        const labels = {};
        const listing = [];

        // Pass 1: Calculate label addresses
        let address = CODE_START;
        for (const instr of instructions) {
            if (instr.label) {
                if (labels[instr.label] !== undefined) {
                    errors.push({ line: instr.sourceLine || 0, message: `Duplicate label: ${instr.label}` });
                } else {
                    labels[instr.label] = address;
                }
            }
            if (instr.mnemonic) {
                const size = this._getInstructionSize(instr);
                if (size === -1) {
                    errors.push({ line: instr.sourceLine || 0, message: `Unknown instruction: ${instr.mnemonic}` });
                } else {
                    address += size;
                }
            }
        }

        if (errors.length > 0) {
            return { bytes: [], listing, errors, labels };
        }

        // Pass 2: Generate bytes
        const bytes = [];
        address = CODE_START;

        for (const instr of instructions) {
            if (!instr.mnemonic) continue;

            const encoded = this._encode(instr, labels, address);
            if (encoded.error) {
                errors.push({ line: instr.sourceLine || 0, message: encoded.error });
                continue;
            }

            listing.push({
                address,
                bytes: encoded.bytes.slice(),
                mnemonic: instr.mnemonic,
                operands: instr.operands || [],
                sourceLine: instr.sourceLine || 0,
                label: instr.label || null,
                text: this._formatInstruction(instr)
            });

            for (const b of encoded.bytes) {
                bytes.push(b);
            }
            address += encoded.bytes.length;
        }

        if (address > DATA_START) {
            errors.push({ line: 0, message: `Program too large: ${address} bytes (max ${DATA_START})` });
        }

        this.bus.emit('assembled', { bytes, listing, errors, labels, programSize: bytes.length });

        return { bytes, listing, errors, labels };
    }

    _parseRegister(s) {
        if (typeof s !== 'string') return -1;
        const m = s.toUpperCase().match(/^R([0-3])$/);
        return m ? parseInt(m[1]) : -1;
    }

    _parseImmediate(s, labels) {
        if (typeof s !== 'string') return NaN;
        s = s.trim();
        // Check if it's a label reference
        if (labels && labels[s] !== undefined) {
            return labels[s];
        }
        // Hex
        if (s.startsWith('0x') || s.startsWith('0X')) {
            return parseInt(s, 16);
        }
        // Binary
        if (s.startsWith('0b') || s.startsWith('0B')) {
            return parseInt(s.substring(2), 2);
        }
        // Decimal (including negative)
        return parseInt(s, 10);
    }

    _getInstructionSize(instr) {
        const mn = instr.mnemonic.toUpperCase();
        const ops = instr.operands || [];

        // Look up from ISA
        switch (mn) {
            case 'NOP': return 1;
            case 'HLT': return 1;
            case 'RET': return 1;
            case 'MOV':
                // MOV Rd, Rs (2 bytes) or MOV Rd, #imm (3 bytes)
                if (ops.length === 2) {
                    return this._parseRegister(ops[1]) >= 0 ? 2 : 3;
                }
                return -1;
            case 'LOAD':
                // LOAD Rd, [addr] (3 bytes) or LOAD Rd, [Rs] (2 bytes)
                if (ops.length === 2) {
                    return this._parseRegister(ops[1]) >= 0 ? 2 : 3;
                }
                return -1;
            case 'STORE':
                // STORE Rs, [addr] (3 bytes) or STORE Rs, [Rd] (2 bytes)
                if (ops.length === 2) {
                    return this._parseRegister(ops[1]) >= 0 ? 2 : 3;
                }
                return -1;
            case 'ADD': case 'SUB': case 'MUL':
                if (ops.length === 2) {
                    return this._parseRegister(ops[1]) >= 0 ? 2 : 3;
                }
                return -1;
            case 'AND': case 'OR': case 'XOR':
                return 2;
            case 'NOT': case 'INC': case 'DEC':
                return 2;
            case 'SHL': case 'SHR':
                return 3;
            case 'CMP':
                if (ops.length === 2) {
                    return this._parseRegister(ops[1]) >= 0 ? 2 : 3;
                }
                return -1;
            case 'JMP': case 'JZ': case 'JNZ': case 'JG': case 'JL': case 'JGE': case 'JLE':
                return 2;
            case 'PUSH':
                return 2;
            case 'POP':
                return 2;
            case 'CALL':
                return 2;
            case 'OUT':
                // OUT Rs (2 bytes) or OUT #imm (2 bytes)
                return 2;
            default:
                return -1;
        }
    }

    _encode(instr, labels, currentAddress) {
        const mn = instr.mnemonic.toUpperCase();
        const ops = instr.operands || [];
        const bytes = [];

        const rd = ops[0] ? this._parseRegister(ops[0]) : -1;
        const rs = ops[1] ? this._parseRegister(ops[1]) : -1;

        switch (mn) {
            case 'NOP':
                bytes.push(OP.NOP);
                break;

            case 'HLT':
                bytes.push(OP.HLT);
                break;

            case 'RET':
                bytes.push(OP.RET);
                break;

            case 'MOV':
                if (rd < 0) return { error: `MOV: invalid destination register: ${ops[0]}` };
                if (rs >= 0) {
                    // MOV Rd, Rs
                    bytes.push(OP.MOV_RR);
                    bytes.push((rd << 4) | rs);
                } else {
                    // MOV Rd, #imm
                    const imm = this._parseImmediate(ops[1], labels);
                    if (isNaN(imm)) return { error: `MOV: invalid immediate: ${ops[1]}` };
                    bytes.push(OP.MOV_RI);
                    bytes.push(rd);
                    bytes.push(imm & 0xFF);
                }
                break;

            case 'LOAD': {
                if (rd < 0) return { error: `LOAD: invalid destination register: ${ops[0]}` };
                const srcReg = this._parseRegister(ops[1]);
                if (srcReg >= 0) {
                    // LOAD Rd, [Rs]
                    bytes.push(OP.LOAD_RR);
                    bytes.push((rd << 4) | srcReg);
                } else {
                    // LOAD Rd, [addr]
                    const addr = this._parseImmediate(ops[1], labels);
                    if (isNaN(addr)) return { error: `LOAD: invalid address: ${ops[1]}` };
                    bytes.push(OP.LOAD);
                    bytes.push(rd);
                    bytes.push(addr & 0xFF);
                }
                break;
            }

            case 'STORE': {
                const srcReg2 = this._parseRegister(ops[0]);
                if (srcReg2 < 0) return { error: `STORE: invalid source register: ${ops[0]}` };
                const dstReg = this._parseRegister(ops[1]);
                if (dstReg >= 0) {
                    // STORE Rs, [Rd]
                    bytes.push(OP.STORE_RR);
                    bytes.push((dstReg << 4) | srcReg2);
                } else {
                    // STORE Rs, [addr]
                    const addr2 = this._parseImmediate(ops[1], labels);
                    if (isNaN(addr2)) return { error: `STORE: invalid address: ${ops[1]}` };
                    bytes.push(OP.STORE);
                    bytes.push(srcReg2);
                    bytes.push(addr2 & 0xFF);
                }
                break;
            }

            case 'ADD': case 'SUB': case 'MUL': {
                if (rd < 0) return { error: `${mn}: invalid destination register: ${ops[0]}` };
                const opcodes = {
                    'ADD': [OP.ADD_RR, OP.ADD_RI],
                    'SUB': [OP.SUB_RR, OP.SUB_RI],
                    'MUL': [OP.MUL_RR, OP.MUL_RI],
                };
                if (rs >= 0) {
                    bytes.push(opcodes[mn][0]);
                    bytes.push((rd << 4) | rs);
                } else {
                    const imm = this._parseImmediate(ops[1], labels);
                    if (isNaN(imm)) return { error: `${mn}: invalid immediate: ${ops[1]}` };
                    bytes.push(opcodes[mn][1]);
                    bytes.push(rd);
                    bytes.push(imm & 0xFF);
                }
                break;
            }

            case 'INC': case 'DEC': case 'NOT': {
                if (rd < 0) return { error: `${mn}: invalid register: ${ops[0]}` };
                const opMap = { 'INC': OP.INC, 'DEC': OP.DEC, 'NOT': OP.NOT };
                bytes.push(opMap[mn]);
                bytes.push(rd);
                break;
            }

            case 'AND': case 'OR': case 'XOR': {
                if (rd < 0 || rs < 0) return { error: `${mn}: requires two registers` };
                const logicMap = { 'AND': OP.AND_RR, 'OR': OP.OR_RR, 'XOR': OP.XOR_RR };
                bytes.push(logicMap[mn]);
                bytes.push((rd << 4) | rs);
                break;
            }

            case 'SHL': case 'SHR': {
                if (rd < 0) return { error: `${mn}: invalid register: ${ops[0]}` };
                const imm = this._parseImmediate(ops[1], labels);
                if (isNaN(imm)) return { error: `${mn}: invalid shift amount: ${ops[1]}` };
                bytes.push(mn === 'SHL' ? OP.SHL : OP.SHR);
                bytes.push(rd);
                bytes.push(imm & 0xFF);
                break;
            }

            case 'CMP': {
                if (rd < 0) return { error: `CMP: invalid register: ${ops[0]}` };
                if (rs >= 0) {
                    bytes.push(OP.CMP_RR);
                    bytes.push((rd << 4) | rs);
                } else {
                    const imm = this._parseImmediate(ops[1], labels);
                    if (isNaN(imm)) return { error: `CMP: invalid immediate: ${ops[1]}` };
                    bytes.push(OP.CMP_RI);
                    bytes.push(rd);
                    bytes.push(imm & 0xFF);
                }
                break;
            }

            case 'JMP': case 'JZ': case 'JNZ': case 'JG': case 'JL': case 'JGE': case 'JLE': {
                const jmpMap = {
                    'JMP': OP.JMP, 'JZ': OP.JZ, 'JNZ': OP.JNZ,
                    'JG': OP.JG, 'JL': OP.JL, 'JGE': OP.JGE, 'JLE': OP.JLE
                };
                const target = this._parseImmediate(ops[0], labels);
                if (isNaN(target)) return { error: `${mn}: invalid target: ${ops[0]}` };
                bytes.push(jmpMap[mn]);
                bytes.push(target & 0xFF);
                break;
            }

            case 'PUSH': {
                const preg = this._parseRegister(ops[0]);
                if (preg >= 0) {
                    bytes.push(OP.PUSH);
                    bytes.push(preg);
                } else {
                    const imm = this._parseImmediate(ops[0], labels);
                    if (isNaN(imm)) return { error: `PUSH: invalid operand: ${ops[0]}` };
                    bytes.push(OP.PUSH_I);
                    bytes.push(imm & 0xFF);
                }
                break;
            }

            case 'POP': {
                if (rd < 0) return { error: `POP: invalid register: ${ops[0]}` };
                bytes.push(OP.POP);
                bytes.push(rd);
                break;
            }

            case 'CALL': {
                const target = this._parseImmediate(ops[0], labels);
                if (isNaN(target)) return { error: `CALL: invalid target: ${ops[0]}` };
                bytes.push(OP.CALL);
                bytes.push(target & 0xFF);
                break;
            }

            case 'OUT': {
                const outReg = this._parseRegister(ops[0]);
                if (outReg >= 0) {
                    bytes.push(OP.OUT);
                    bytes.push(outReg);
                } else {
                    const imm = this._parseImmediate(ops[0], labels);
                    if (isNaN(imm)) return { error: `OUT: invalid operand: ${ops[0]}` };
                    bytes.push(OP.OUT_I);
                    bytes.push(imm & 0xFF);
                }
                break;
            }

            default:
                return { error: `Unknown instruction: ${mn}` };
        }

        return { bytes };
    }

    _formatInstruction(instr) {
        const parts = [instr.mnemonic.toUpperCase()];
        if (instr.operands && instr.operands.length > 0) {
            parts.push(instr.operands.join(', '));
        }
        return parts.join(' ');
    }

    /**
     * Parse assembly text into instruction objects
     */
    parseText(text) {
        const lines = text.split('\n');
        const instructions = [];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i].trim();

            // Remove comments
            const commentIdx = line.indexOf(';');
            if (commentIdx >= 0) line = line.substring(0, commentIdx).trim();
            if (line === '') continue;

            let label = null;

            // Check for label
            const labelMatch = line.match(/^([a-zA-Z_]\w*):\s*(.*)/);
            if (labelMatch) {
                label = labelMatch[1];
                line = labelMatch[2].trim();
            }

            if (line === '' && label) {
                // Label-only line
                instructions.push({ label, mnemonic: null, operands: [], sourceLine: i + 1 });
                continue;
            }

            if (line === '') continue;

            // Parse mnemonic and operands
            const parts = line.split(/\s+/);
            const mnemonic = parts[0].toUpperCase();
            const operandStr = parts.slice(1).join(' ');
            const operands = operandStr ? operandStr.split(',').map(s => s.trim()).filter(s => s) : [];

            instructions.push({ label, mnemonic, operands, sourceLine: i + 1 });
        }

        return instructions;
    }

    /**
     * Assemble text directly
     */
    assembleText(text) {
        const parsed = this.parseText(text);
        return this.assemble(parsed);
    }

    /**
     * Disassemble bytes starting at an address
     * Returns a human-readable string for one instruction
     */
    disassemble(memory, address) {
        const opcode = memory.peek(address);
        const info = INSTRUCTION_SET[opcode];

        if (!info) {
            return { text: `DB 0x${opcode.toString(16).toUpperCase().padStart(2, '0')}`, size: 1 };
        }

        let text = info.mnemonic;
        let size = info.size;

        switch (info.format) {
            case 'none':
                break;
            case 'rr': {
                const byte2 = memory.peek(address + 1);
                const rd = (byte2 >> 4) & 0x03;
                const rs = byte2 & 0x03;
                if (opcode === OP.LOAD_RR) {
                    text += ` R${rd}, [R${rs}]`;
                } else if (opcode === OP.STORE_RR) {
                    text += ` R${rs}, [R${rd}]`;
                } else {
                    text += ` R${rd}, R${rs}`;
                }
                break;
            }
            case 'ri': {
                const rd = memory.peek(address + 1) & 0x03;
                const imm = memory.peek(address + 2);
                text += ` R${rd}, ${imm}`;
                break;
            }
            case 'ra': {
                const rd = memory.peek(address + 1) & 0x03;
                const addr = memory.peek(address + 2);
                if (opcode === OP.STORE) {
                    text += ` R${rd}, [0x${addr.toString(16).toUpperCase().padStart(2, '0')}]`;
                } else {
                    text += ` R${rd}, [0x${addr.toString(16).toUpperCase().padStart(2, '0')}]`;
                }
                break;
            }
            case 'r': {
                const rd = memory.peek(address + 1) & 0x03;
                text += ` R${rd}`;
                break;
            }
            case 'addr': {
                const addr = memory.peek(address + 1);
                text += ` 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                break;
            }
            case 'imm': {
                const imm = memory.peek(address + 1);
                text += ` ${imm}`;
                break;
            }
        }

        return { text, size };
    }
}


// ============================================================================
// CPU — The processor
// ============================================================================

class CPU {
    constructor(bus) {
        this.bus = bus;
        this.memory = new Memory(bus);
        this.registers = new Registers(bus);
        this.flags = new Flags(bus);
        this.alu = new ALU(bus);
        this.assembler = new Assembler(bus);

        this._halted = false;
        this._running = false;
        this._cycleCount = 0;
        this._maxCycles = 10000; // Safety limit
        this._breakpoints = new Set();
        this._trace = [];
        this._maxTrace = 500;
        this._snapshots = []; // For timeline/time-travel debugging
        this._maxSnapshots = 200;
        this._speed = 5; // Steps per second (for animated execution)
        this._animationFrame = null;
        this._programEnd = 0; // End of loaded program

        // Output buffer
        this._output = [];
    }

    get halted() { return this._halted; }
    get running() { return this._running; }
    get cycleCount() { return this._cycleCount; }
    get trace() { return this._trace; }
    get output() { return this._output; }
    get speed() { return this._speed; }
    set speed(v) { this._speed = Math.max(1, Math.min(1000, v)); }
    get programEnd() { return this._programEnd; }

    // ─── Reset ──────────────────────────────────────────────────────────
    reset() {
        this._halted = false;
        this._running = false;
        this._cycleCount = 0;
        this._trace = [];
        this._snapshots = [];
        this._output = [];
        this.registers.reset();
        this.flags.reset();
        this.memory.clear();
        if (this._animationFrame) {
            cancelAnimationFrame(this._animationFrame);
            this._animationFrame = null;
        }
        this.bus.emit('cpuReset', {});
    }

    // ─── Load Program ───────────────────────────────────────────────────
    loadProgram(bytes) {
        // Don't fully reset — preserve memory clear, but reset registers
        this._halted = false;
        this._running = false;
        this._cycleCount = 0;
        this._trace = [];
        this._snapshots = [];
        this._output = [];
        this.registers.reset();
        this.flags.reset();
        this.memory.clear();
        this.memory.loadProgram(bytes);
        this._programEnd = bytes.length;
        this.bus.emit('programLoaded', { bytes, size: bytes.length });
    }

    // ─── Take State Snapshot ────────────────────────────────────────────
    _takeSnapshot() {
        if (this._snapshots.length >= this._maxSnapshots) {
            this._snapshots.shift();
        }
        this._snapshots.push({
            cycle: this._cycleCount,
            memory: this.memory.snapshot(),
            registers: this.registers.snapshot(),
            flags: this.flags.snapshot(),
            halted: this._halted,
            output: this._output.slice(),
            pc: this.registers.pc
        });
    }

    // ─── Restore to a specific cycle ────────────────────────────────────
    restoreToSnapshot(index) {
        if (index < 0 || index >= this._snapshots.length) return false;
        const snap = this._snapshots[index];
        this.memory.restore(snap.memory);
        this.registers.restore(snap.registers);
        this.flags.restore(snap.flags);
        this._halted = snap.halted;
        this._output = snap.output.slice();
        this._cycleCount = snap.cycle;
        // Trim snapshots to this point
        this._snapshots = this._snapshots.slice(0, index + 1);
        // Trim trace to this cycle
        this._trace = this._trace.filter(t => t.cycle <= snap.cycle);
        this.bus.emit('snapshotRestored', { cycle: snap.cycle, index });
        return true;
    }

    get snapshots() { return this._snapshots; }

    // ─── Step — Execute one instruction ─────────────────────────────────
    step() {
        if (this._halted) {
            this.bus.emit('cpuHalted', { reason: 'already halted', cycle: this._cycleCount });
            return false;
        }

        if (this._cycleCount >= this._maxCycles) {
            this._halted = true;
            this.bus.emit('cpuHalted', { reason: 'max cycles exceeded', cycle: this._cycleCount });
            return false;
        }

        // Take snapshot before execution
        this._takeSnapshot();

        const pc = this.registers.pc;
        const opcode = this.memory.peek(pc);
        const info = INSTRUCTION_SET[opcode];

        this._cycleCount++;

        if (!info) {
            this._halted = true;
            const traceEntry = {
                cycle: this._cycleCount,
                pc,
                opcode,
                text: 'INVALID',
                description: `Invalid opcode 0x${opcode.toString(16).toUpperCase()}`
            };
            this._addTrace(traceEntry);
            this.bus.emit('cpuHalted', { reason: 'invalid opcode', cycle: this._cycleCount, pc, opcode });
            return false;
        }

        // Emit fetch event
        this.bus.emit('fetch', { pc, opcode, mnemonic: info.mnemonic, cycle: this._cycleCount });

        // Decode + Execute
        const result = this._execute(opcode, pc, info);

        // Emit decode event
        this.bus.emit('decode', { pc, opcode, info, cycle: this._cycleCount, text: result.text });

        // Add trace entry
        this._addTrace(result.traceEntry);

        // Emit execute event
        this.bus.emit('instructionExecuted', {
            cycle: this._cycleCount,
            pc,
            opcode,
            text: result.text,
            description: result.description,
            nextPC: this.registers.pc,
            traceEntry: result.traceEntry
        });

        if (this._halted) {
            this.bus.emit('cpuHalted', { reason: 'HLT instruction', cycle: this._cycleCount });
        }

        return !this._halted;
    }

    // ─── Execute single instruction ─────────────────────────────────────
    _execute(opcode, pc, info) {
        let text = info.mnemonic;
        let description = '';
        const changes = {};

        switch (opcode) {
            case OP.NOP: {
                text = 'NOP';
                description = 'No operation';
                this.registers.pc = pc + 1;
                break;
            }

            case OP.HLT: {
                text = 'HLT';
                description = 'CPU halted';
                this._halted = true;
                this.registers.pc = pc + 1;
                break;
            }

            case OP.MOV_RR: {
                const byte2 = this.memory.peek(pc + 1);
                const rd = (byte2 >> 4) & 0x03;
                const rs = byte2 & 0x03;
                const val = this.registers.get(rs);
                this.registers.set(rd, val);
                text = `MOV R${rd}, R${rs}`;
                description = `R${rd} = R${rs} = ${val}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.MOV_RI: {
                const rd = this.memory.peek(pc + 1) & 0x03;
                const imm = this.memory.peek(pc + 2);
                this.registers.set(rd, imm);
                text = `MOV R${rd}, ${imm}`;
                description = `R${rd} = ${imm}`;
                changes.rd = rd;
                this.registers.pc = pc + 3;
                break;
            }

            case OP.LOAD: {
                const rd = this.memory.peek(pc + 1) & 0x03;
                const addr = this.memory.peek(pc + 2);
                const val = this.memory.read(addr);
                this.registers.set(rd, val);
                text = `LOAD R${rd}, [0x${addr.toString(16).toUpperCase().padStart(2, '0')}]`;
                description = `R${rd} = mem[0x${addr.toString(16).toUpperCase().padStart(2, '0')}] = ${val}`;
                changes.rd = rd;
                changes.memRead = addr;
                this.registers.pc = pc + 3;
                break;
            }

            case OP.STORE: {
                const rs = this.memory.peek(pc + 1) & 0x03;
                const addr = this.memory.peek(pc + 2);
                const val = this.registers.get(rs);
                this.memory.write(addr, val);
                text = `STORE R${rs}, [0x${addr.toString(16).toUpperCase().padStart(2, '0')}]`;
                description = `mem[0x${addr.toString(16).toUpperCase().padStart(2, '0')}] = R${rs} = ${val}`;
                changes.memWrite = addr;
                this.registers.pc = pc + 3;
                break;
            }

            case OP.LOAD_RR: {
                const byte2 = this.memory.peek(pc + 1);
                const rd = (byte2 >> 4) & 0x03;
                const rs = byte2 & 0x03;
                const addr = this.registers.get(rs);
                const val = this.memory.read(addr);
                this.registers.set(rd, val);
                text = `LOAD R${rd}, [R${rs}]`;
                description = `R${rd} = mem[R${rs}] = mem[${addr}] = ${val}`;
                changes.rd = rd;
                changes.memRead = addr;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.STORE_RR: {
                const byte2 = this.memory.peek(pc + 1);
                const rd = (byte2 >> 4) & 0x03;
                const rs = byte2 & 0x03;
                const val = this.registers.get(rs);
                const addr = this.registers.get(rd);
                this.memory.write(addr, val);
                text = `STORE R${rs}, [R${rd}]`;
                description = `mem[R${rd}] = mem[${addr}] = R${rs} = ${val}`;
                changes.memWrite = addr;
                this.registers.pc = pc + 2;
                break;
            }

            // Arithmetic
            case OP.ADD_RR: case OP.SUB_RR: case OP.MUL_RR: {
                const byte2 = this.memory.peek(pc + 1);
                const rd = (byte2 >> 4) & 0x03;
                const rs = byte2 & 0x03;
                const a = this.registers.get(rd);
                const b = this.registers.get(rs);
                const opName = opcode === OP.ADD_RR ? 'ADD' : opcode === OP.SUB_RR ? 'SUB' : 'MUL';
                const aluResult = this.alu.execute(opName, a, b);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.rawResult, a, b, aluResult.isSub);
                text = `${opName} R${rd}, R${rs}`;
                description = `R${rd} = ${a} ${opName === 'ADD' ? '+' : opName === 'SUB' ? '-' : '*'} ${b} = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.ADD_RI: case OP.SUB_RI: case OP.MUL_RI: {
                const rd = this.memory.peek(pc + 1) & 0x03;
                const imm = this.memory.peek(pc + 2);
                const a = this.registers.get(rd);
                const opName = opcode === OP.ADD_RI ? 'ADD' : opcode === OP.SUB_RI ? 'SUB' : 'MUL';
                const aluResult = this.alu.execute(opName, a, imm);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.rawResult, a, imm, aluResult.isSub);
                text = `${opName} R${rd}, ${imm}`;
                description = `R${rd} = ${a} ${opName === 'ADD' ? '+' : opName === 'SUB' ? '-' : '*'} ${imm} = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 3;
                break;
            }

            case OP.INC: {
                const rd = this.memory.peek(pc + 1) & 0x03;
                const a = this.registers.get(rd);
                const aluResult = this.alu.execute('INC', a);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.rawResult, a, 1, false);
                text = `INC R${rd}`;
                description = `R${rd} = ${a} + 1 = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.DEC: {
                const rd = this.memory.peek(pc + 1) & 0x03;
                const a = this.registers.get(rd);
                const aluResult = this.alu.execute('DEC', a);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.rawResult, a, 1, true);
                text = `DEC R${rd}`;
                description = `R${rd} = ${a} - 1 = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            // Logic
            case OP.AND_RR: case OP.OR_RR: case OP.XOR_RR: {
                const byte2 = this.memory.peek(pc + 1);
                const rd = (byte2 >> 4) & 0x03;
                const rs = byte2 & 0x03;
                const a = this.registers.get(rd);
                const b = this.registers.get(rs);
                const opName = opcode === OP.AND_RR ? 'AND' : opcode === OP.OR_RR ? 'OR' : 'XOR';
                const aluResult = this.alu.execute(opName, a, b);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.rawResult, a, b);
                text = `${opName} R${rd}, R${rs}`;
                const sym = opName === 'AND' ? '&' : opName === 'OR' ? '|' : '^';
                description = `R${rd} = ${a} ${sym} ${b} = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.NOT: {
                const rd = this.memory.peek(pc + 1) & 0x03;
                const a = this.registers.get(rd);
                const aluResult = this.alu.execute('NOT', a);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.rawResult, a, 0);
                text = `NOT R${rd}`;
                description = `R${rd} = ~${a} = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.SHL: case OP.SHR: {
                const rd = this.memory.peek(pc + 1) & 0x03;
                const imm = this.memory.peek(pc + 2);
                const a = this.registers.get(rd);
                const opName = opcode === OP.SHL ? 'SHL' : 'SHR';
                const aluResult = this.alu.execute(opName, a, imm);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.rawResult, a, imm);
                text = `${opName} R${rd}, ${imm}`;
                description = `R${rd} = ${a} ${opName === 'SHL' ? '<<' : '>>'} ${imm} = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 3;
                break;
            }

            // Comparison
            case OP.CMP_RR: {
                const byte2 = this.memory.peek(pc + 1);
                const rd = (byte2 >> 4) & 0x03;
                const rs = byte2 & 0x03;
                const a = this.registers.get(rd);
                const b = this.registers.get(rs);
                const aluResult = this.alu.execute('CMP', a, b);
                this.flags.update(aluResult.rawResult, a, b, true);
                text = `CMP R${rd}, R${rs}`;
                description = `Compare ${a} - ${b} = ${aluResult.result} ${this.flags.toString()}`;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.CMP_RI: {
                const rd = this.memory.peek(pc + 1) & 0x03;
                const imm = this.memory.peek(pc + 2);
                const a = this.registers.get(rd);
                const aluResult = this.alu.execute('CMP', a, imm);
                this.flags.update(aluResult.rawResult, a, imm, true);
                text = `CMP R${rd}, ${imm}`;
                description = `Compare ${a} - ${imm} = ${aluResult.result} ${this.flags.toString()}`;
                this.registers.pc = pc + 3;
                break;
            }

            // Branching
            case OP.JMP: {
                const addr = this.memory.peek(pc + 1);
                this.registers.pc = addr;
                text = `JMP 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                description = `PC = 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                break;
            }

            case OP.JZ: {
                const addr = this.memory.peek(pc + 1);
                text = `JZ 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                if (this.flags.zero) {
                    this.registers.pc = addr;
                    description = `ZF=1 → Jump to 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                } else {
                    this.registers.pc = pc + 2;
                    description = `ZF=0 → No jump`;
                }
                break;
            }

            case OP.JNZ: {
                const addr = this.memory.peek(pc + 1);
                text = `JNZ 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                if (!this.flags.zero) {
                    this.registers.pc = addr;
                    description = `ZF=0 → Jump to 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                } else {
                    this.registers.pc = pc + 2;
                    description = `ZF=1 → No jump`;
                }
                break;
            }

            case OP.JG: {
                const addr = this.memory.peek(pc + 1);
                text = `JG 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                if (!this.flags.zero && !this.flags.negative) {
                    this.registers.pc = addr;
                    description = `Greater → Jump`;
                } else {
                    this.registers.pc = pc + 2;
                    description = `Not greater → No jump`;
                }
                break;
            }

            case OP.JL: {
                const addr = this.memory.peek(pc + 1);
                text = `JL 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                if (this.flags.negative) {
                    this.registers.pc = addr;
                    description = `Less → Jump`;
                } else {
                    this.registers.pc = pc + 2;
                    description = `Not less → No jump`;
                }
                break;
            }

            case OP.JGE: {
                const addr = this.memory.peek(pc + 1);
                text = `JGE 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                if (this.flags.zero || !this.flags.negative) {
                    this.registers.pc = addr;
                    description = `Greater or equal → Jump`;
                } else {
                    this.registers.pc = pc + 2;
                    description = `Less → No jump`;
                }
                break;
            }

            case OP.JLE: {
                const addr = this.memory.peek(pc + 1);
                text = `JLE 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                if (this.flags.zero || this.flags.negative) {
                    this.registers.pc = addr;
                    description = `Less or equal → Jump`;
                } else {
                    this.registers.pc = pc + 2;
                    description = `Greater → No jump`;
                }
                break;
            }

            // Stack
            case OP.PUSH: {
                const rs = this.memory.peek(pc + 1) & 0x03;
                const val = this.registers.get(rs);
                const sp = this.registers.sp;
                this.memory.write(sp, val);
                this.registers.sp = sp - 1;
                text = `PUSH R${rs}`;
                description = `mem[0x${sp.toString(16).toUpperCase().padStart(2, '0')}] = R${rs} = ${val}, SP = 0x${(sp - 1).toString(16).toUpperCase().padStart(2, '0')}`;
                changes.memWrite = sp;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.PUSH_I: {
                const imm = this.memory.peek(pc + 1);
                const sp = this.registers.sp;
                this.memory.write(sp, imm);
                this.registers.sp = sp - 1;
                text = `PUSH ${imm}`;
                description = `mem[0x${sp.toString(16).toUpperCase().padStart(2, '0')}] = ${imm}, SP = 0x${(sp - 1).toString(16).toUpperCase().padStart(2, '0')}`;
                changes.memWrite = sp;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.POP: {
                const rd = this.memory.peek(pc + 1) & 0x03;
                const sp = this.registers.sp + 1;
                this.registers.sp = sp;
                const val = this.memory.read(sp);
                this.registers.set(rd, val);
                text = `POP R${rd}`;
                description = `SP = 0x${sp.toString(16).toUpperCase().padStart(2, '0')}, R${rd} = mem[SP] = ${val}`;
                changes.rd = rd;
                changes.memRead = sp;
                this.registers.pc = pc + 2;
                break;
            }

            // Subroutines
            case OP.CALL: {
                const addr = this.memory.peek(pc + 1);
                const returnAddr = pc + 2;
                const sp = this.registers.sp;
                this.memory.write(sp, returnAddr);
                this.registers.sp = sp - 1;
                this.registers.pc = addr;
                text = `CALL 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                description = `Push return addr 0x${returnAddr.toString(16).toUpperCase().padStart(2, '0')}, jump to 0x${addr.toString(16).toUpperCase().padStart(2, '0')}`;
                changes.memWrite = sp;
                break;
            }

            case OP.RET: {
                const sp = this.registers.sp + 1;
                this.registers.sp = sp;
                const returnAddr = this.memory.read(sp);
                this.registers.pc = returnAddr;
                text = `RET`;
                description = `Return to 0x${returnAddr.toString(16).toUpperCase().padStart(2, '0')}`;
                changes.memRead = sp;
                break;
            }

            // I/O
            case OP.OUT: {
                const rs = this.memory.peek(pc + 1) & 0x03;
                const val = this.registers.get(rs);
                this._output.push(val);
                text = `OUT R${rs}`;
                description = `Output R${rs} = ${val}`;
                this.bus.emit('output', { value: val, source: `R${rs}` });
                this.registers.pc = pc + 2;
                break;
            }

            case OP.OUT_I: {
                const imm = this.memory.peek(pc + 1);
                this._output.push(imm);
                text = `OUT ${imm}`;
                description = `Output ${imm}`;
                this.bus.emit('output', { value: imm, source: 'immediate' });
                this.registers.pc = pc + 2;
                break;
            }

            default: {
                this._halted = true;
                text = `??? 0x${opcode.toString(16).toUpperCase()}`;
                description = `Unknown opcode`;
                this.registers.pc = pc + 1;
            }
        }

        const traceEntry = {
            cycle: this._cycleCount,
            pc,
            opcode,
            text,
            description,
            flags: this.flags.toString(),
            registers: Array.from({ length: NUM_REGISTERS }, (_, i) => this.registers.get(i)),
            sp: this.registers.sp,
            changes
        };

        return { text, description, traceEntry };
    }

    _addTrace(entry) {
        if (this._trace.length >= this._maxTrace) {
            this._trace.shift();
        }
        this._trace.push(entry);
    }

    // ─── Run — Continuous execution with animation ──────────────────────
    run() {
        if (this._halted || this._running) return;
        this._running = true;
        this.bus.emit('cpuRunning', { speed: this._speed });
        this._runLoop();
    }

    _runLoop() {
        if (!this._running || this._halted) {
            this._running = false;
            this.bus.emit('cpuStopped', { cycle: this._cycleCount });
            return;
        }

        // Execute based on speed
        if (this._speed >= 100) {
            // Burst mode: execute multiple steps per frame
            const stepsPerFrame = Math.min(this._speed, 500);
            for (let i = 0; i < stepsPerFrame; i++) {
                if (!this.step()) {
                    this._running = false;
                    this.bus.emit('cpuStopped', { cycle: this._cycleCount });
                    return;
                }
                // Check breakpoints
                if (this._breakpoints.has(this.registers.pc)) {
                    this._running = false;
                    this.bus.emit('breakpointHit', { pc: this.registers.pc, cycle: this._cycleCount });
                    this.bus.emit('cpuStopped', { cycle: this._cycleCount });
                    return;
                }
            }
            this._animationFrame = requestAnimationFrame(() => this._runLoop());
        } else {
            // Slow mode: one step, then delay
            if (!this.step()) {
                this._running = false;
                this.bus.emit('cpuStopped', { cycle: this._cycleCount });
                return;
            }
            // Check breakpoints
            if (this._breakpoints.has(this.registers.pc)) {
                this._running = false;
                this.bus.emit('breakpointHit', { pc: this.registers.pc, cycle: this._cycleCount });
                this.bus.emit('cpuStopped', { cycle: this._cycleCount });
                return;
            }
            const delay = 1000 / this._speed;
            setTimeout(() => {
                this._animationFrame = requestAnimationFrame(() => this._runLoop());
            }, delay);
        }
    }

    // ─── Pause execution ────────────────────────────────────────────────
    pause() {
        this._running = false;
        if (this._animationFrame) {
            cancelAnimationFrame(this._animationFrame);
            this._animationFrame = null;
        }
        this.bus.emit('cpuPaused', { cycle: this._cycleCount });
    }

    // ─── Run to completion (synchronous, no animation) ──────────────────
    runToEnd() {
        let steps = 0;
        while (!this._halted && steps < this._maxCycles) {
            this.step();
            steps++;
            if (this._breakpoints.has(this.registers.pc)) {
                this.bus.emit('breakpointHit', { pc: this.registers.pc, cycle: this._cycleCount });
                break;
            }
        }
        this.bus.emit('cpuStopped', { cycle: this._cycleCount });
    }

    // ─── Breakpoints ────────────────────────────────────────────────────
    addBreakpoint(address) {
        this._breakpoints.add(address);
        this.bus.emit('breakpointAdded', { address });
    }

    removeBreakpoint(address) {
        this._breakpoints.delete(address);
        this.bus.emit('breakpointRemoved', { address });
    }

    toggleBreakpoint(address) {
        if (this._breakpoints.has(address)) {
            this.removeBreakpoint(address);
        } else {
            this.addBreakpoint(address);
        }
    }

    get breakpoints() { return this._breakpoints; }
}


// ============================================================================
// Exports (global, since no module system)
// ============================================================================

window.MiniCPU = {
    EventBus,
    Memory,
    Registers,
    Flags,
    ALU,
    Assembler,
    CPU,
    // Constants
    OP,
    OP_NAMES,
    INSTRUCTION_SET,
    REG_NAMES,
    MEMORY_SIZE,
    NUM_REGISTERS,
    STACK_START,
    DATA_START,
    CODE_START,
};
