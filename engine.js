// ============================================================================
// engine.js — MiniCPU 32-bit Hardware Engine
// ============================================================================
// Contains: EventBus, Memory, Registers, Flags, ALU, Stack, InstructionSet,
//           Assembler, Loader, CPU, Debugger
// Architecture: 32-bit RISC-like, 8 general-purpose registers, 4KB memory
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
// Constants — 32-bit ISA Definition
// ============================================================================

const MEMORY_SIZE = 4096;      // 4 KB addressable (0x000–0xFFF)
const NUM_REGISTERS = 8;       // R0–R7
const STACK_START = 0xFFC;     // Stack grows downward from 0xFFC
const DATA_START = 0x800;      // Data segment starts at 0x800
const CODE_START = 0x000;      // Code segment starts at 0x000
const WORD_SIZE = 4;           // 32-bit words = 4 bytes

// Opcodes — 32-bit ISA
// Instruction format: [opcode:8][operands:variable]
// All instructions are aligned to byte boundaries
const OP = {
    NOP:    0x00,
    // Data Movement
    MOV_RR: 0x01,   // MOV Rd, Rs          — Rd = Rs                    (2 bytes: op, rd|rs)
    MOV_RI: 0x02,   // MOV Rd, #imm32      — Rd = imm32                (6 bytes: op, rd, imm32)
    LOAD:   0x03,   // LOAD Rd, [addr16]   — Rd = mem32[addr]          (4 bytes: op, rd, addr16)
    STORE:  0x04,   // STORE Rs, [addr16]  — mem32[addr] = Rs          (4 bytes: op, rs, addr16)
    LOAD_RR:0x05,   // LOAD Rd, [Rs]       — Rd = mem32[Rs]            (2 bytes: op, rd|rs)
    STORE_RR:0x06,  // STORE Rs, [Rd]      — mem32[Rd] = Rs            (2 bytes: op, rd|rs)
    // Arithmetic
    ADD_RR: 0x10,   // ADD Rd, Rs          — Rd = Rd + Rs              (2 bytes)
    ADD_RI: 0x11,   // ADD Rd, #imm32      — Rd = Rd + imm32          (6 bytes)
    SUB_RR: 0x12,   // SUB Rd, Rs          — Rd = Rd - Rs              (2 bytes)
    SUB_RI: 0x13,   // SUB Rd, #imm32      — Rd = Rd - imm32          (6 bytes)
    MUL_RR: 0x14,   // MUL Rd, Rs          — Rd = Rd * Rs              (2 bytes)
    MUL_RI: 0x15,   // MUL Rd, #imm32      — Rd = Rd * imm32          (6 bytes)
    DIV_RR: 0x16,   // DIV Rd, Rs          — Rd = Rd / Rs              (2 bytes)
    DIV_RI: 0x17,   // DIV Rd, #imm32      — Rd = Rd / imm32          (6 bytes)
    MOD_RR: 0x18,   // MOD Rd, Rs          — Rd = Rd % Rs              (2 bytes)
    MOD_RI: 0x19,   // MOD Rd, #imm32      — Rd = Rd % imm32          (6 bytes)
    INC:    0x1A,   // INC Rd              — Rd = Rd + 1               (2 bytes)
    DEC:    0x1B,   // DEC Rd              — Rd = Rd - 1               (2 bytes)
    NEG:    0x1C,   // NEG Rd              — Rd = -Rd                  (2 bytes)
    // Logic
    AND_RR: 0x20,   // AND Rd, Rs          — Rd = Rd & Rs              (2 bytes)
    OR_RR:  0x21,   // OR  Rd, Rs          — Rd = Rd | Rs              (2 bytes)
    XOR_RR: 0x22,   // XOR Rd, Rs          — Rd = Rd ^ Rs              (2 bytes)
    NOT:    0x23,   // NOT Rd              — Rd = ~Rd                  (2 bytes)
    SHL:    0x24,   // SHL Rd, #imm8       — Rd = Rd << imm8           (3 bytes)
    SHR:    0x25,   // SHR Rd, #imm8       — Rd = Rd >> imm8           (3 bytes)
    AND_RI: 0x26,   // AND Rd, #imm32      — Rd = Rd & imm32          (6 bytes)
    OR_RI:  0x27,   // OR  Rd, #imm32      — Rd = Rd | imm32          (6 bytes)
    // Comparison
    CMP_RR: 0x30,   // CMP Rd, Rs          — flags = Rd - Rs           (2 bytes)
    CMP_RI: 0x31,   // CMP Rd, #imm32      — flags = Rd - imm32       (6 bytes)
    // Branching (addresses are 16-bit)
    JMP:    0x40,   // JMP addr16          — PC = addr                 (3 bytes)
    JZ:     0x41,   // JZ  addr16          — if ZF: PC = addr          (3 bytes)
    JNZ:    0x42,   // JNZ addr16          — if !ZF: PC = addr         (3 bytes)
    JG:     0x43,   // JG  addr16          — if >: PC = addr           (3 bytes)
    JL:     0x44,   // JL  addr16          — if <: PC = addr           (3 bytes)
    JGE:    0x45,   // JGE addr16          — if >=: PC = addr          (3 bytes)
    JLE:    0x46,   // JLE addr16          — if <=: PC = addr          (3 bytes)
    // Stack (push/pop 32-bit words)
    PUSH:   0x50,   // PUSH Rs             — SP-=4; mem32[SP] = Rs     (2 bytes)
    POP:    0x51,   // POP  Rd             — Rd = mem32[SP]; SP+=4     (2 bytes)
    PUSH_I: 0x52,   // PUSH #imm32         — SP-=4; mem32[SP] = imm32  (5 bytes)
    // Subroutines
    CALL:   0x60,   // CALL addr16         — push PC+3; PC = addr      (3 bytes)
    RET:    0x61,   // RET                 — pop PC                    (1 byte)
    // I/O
    OUT:    0x70,   // OUT Rs              — output Rs value           (2 bytes)
    OUT_I:  0x71,   // OUT #imm32          — output imm32             (5 bytes)
    // System
    SYSCALL:0x80,   // SYSCALL #id         — system call               (2 bytes)
    // System call IDs (in next byte):
    //   0x01 = print integer (R0 = value)
    //   0x02 = print string (R0 = addr of null-terminated string in memory)
    //   0x03 = print char (R0 = ASCII char)
    //   0x04 = print newline
    HLT:    0xFF,   // HLT                 — halt CPU                  (1 byte)
};

// Reverse lookup: opcode number -> name
const OP_NAMES = {};
for (const [name, code] of Object.entries(OP)) {
    OP_NAMES[code] = name;
}

// Instruction format info: opcode -> { size, format, description }
const INSTRUCTION_SET = {
    [OP.NOP]:     { size: 1, format: 'none',     mnemonic: 'NOP',     desc: 'No operation' },
    [OP.MOV_RR]:  { size: 2, format: 'rr',       mnemonic: 'MOV',     desc: 'Copy register to register' },
    [OP.MOV_RI]:  { size: 6, format: 'ri32',     mnemonic: 'MOV',     desc: 'Load 32-bit immediate into register' },
    [OP.LOAD]:    { size: 4, format: 'ra16',     mnemonic: 'LOAD',    desc: 'Load 32-bit word from memory' },
    [OP.STORE]:   { size: 4, format: 'ra16',     mnemonic: 'STORE',   desc: 'Store 32-bit word to memory' },
    [OP.LOAD_RR]: { size: 2, format: 'rr',       mnemonic: 'LOAD',    desc: 'Load from address in register' },
    [OP.STORE_RR]:{ size: 2, format: 'rr',       mnemonic: 'STORE',   desc: 'Store to address in register' },
    [OP.ADD_RR]:  { size: 2, format: 'rr',       mnemonic: 'ADD',     desc: 'Add register to register' },
    [OP.ADD_RI]:  { size: 6, format: 'ri32',     mnemonic: 'ADD',     desc: 'Add 32-bit immediate to register' },
    [OP.SUB_RR]:  { size: 2, format: 'rr',       mnemonic: 'SUB',     desc: 'Subtract register from register' },
    [OP.SUB_RI]:  { size: 6, format: 'ri32',     mnemonic: 'SUB',     desc: 'Subtract 32-bit immediate' },
    [OP.MUL_RR]:  { size: 2, format: 'rr',       mnemonic: 'MUL',     desc: 'Multiply register by register' },
    [OP.MUL_RI]:  { size: 6, format: 'ri32',     mnemonic: 'MUL',     desc: 'Multiply register by immediate' },
    [OP.DIV_RR]:  { size: 2, format: 'rr',       mnemonic: 'DIV',     desc: 'Divide register by register' },
    [OP.DIV_RI]:  { size: 6, format: 'ri32',     mnemonic: 'DIV',     desc: 'Divide register by immediate' },
    [OP.MOD_RR]:  { size: 2, format: 'rr',       mnemonic: 'MOD',     desc: 'Modulo register by register' },
    [OP.MOD_RI]:  { size: 6, format: 'ri32',     mnemonic: 'MOD',     desc: 'Modulo register by immediate' },
    [OP.INC]:     { size: 2, format: 'r',        mnemonic: 'INC',     desc: 'Increment register' },
    [OP.DEC]:     { size: 2, format: 'r',        mnemonic: 'DEC',     desc: 'Decrement register' },
    [OP.NEG]:     { size: 2, format: 'r',        mnemonic: 'NEG',     desc: 'Negate register' },
    [OP.AND_RR]:  { size: 2, format: 'rr',       mnemonic: 'AND',     desc: 'Bitwise AND' },
    [OP.OR_RR]:   { size: 2, format: 'rr',       mnemonic: 'OR',      desc: 'Bitwise OR' },
    [OP.XOR_RR]:  { size: 2, format: 'rr',       mnemonic: 'XOR',     desc: 'Bitwise XOR' },
    [OP.NOT]:     { size: 2, format: 'r',        mnemonic: 'NOT',     desc: 'Bitwise NOT' },
    [OP.SHL]:     { size: 3, format: 'ri8',      mnemonic: 'SHL',     desc: 'Shift left' },
    [OP.SHR]:     { size: 3, format: 'ri8',      mnemonic: 'SHR',     desc: 'Shift right' },
    [OP.AND_RI]:  { size: 6, format: 'ri32',     mnemonic: 'AND',     desc: 'Bitwise AND with immediate' },
    [OP.OR_RI]:   { size: 6, format: 'ri32',     mnemonic: 'OR',      desc: 'Bitwise OR with immediate' },
    [OP.CMP_RR]:  { size: 2, format: 'rr',       mnemonic: 'CMP',     desc: 'Compare registers' },
    [OP.CMP_RI]:  { size: 6, format: 'ri32',     mnemonic: 'CMP',     desc: 'Compare register with immediate' },
    [OP.JMP]:     { size: 3, format: 'addr16',   mnemonic: 'JMP',     desc: 'Unconditional jump' },
    [OP.JZ]:      { size: 3, format: 'addr16',   mnemonic: 'JZ',      desc: 'Jump if zero' },
    [OP.JNZ]:     { size: 3, format: 'addr16',   mnemonic: 'JNZ',     desc: 'Jump if not zero' },
    [OP.JG]:      { size: 3, format: 'addr16',   mnemonic: 'JG',      desc: 'Jump if greater' },
    [OP.JL]:      { size: 3, format: 'addr16',   mnemonic: 'JL',      desc: 'Jump if less' },
    [OP.JGE]:     { size: 3, format: 'addr16',   mnemonic: 'JGE',     desc: 'Jump if greater or equal' },
    [OP.JLE]:     { size: 3, format: 'addr16',   mnemonic: 'JLE',     desc: 'Jump if less or equal' },
    [OP.PUSH]:    { size: 2, format: 'r',        mnemonic: 'PUSH',    desc: 'Push register onto stack' },
    [OP.POP]:     { size: 2, format: 'r',        mnemonic: 'POP',     desc: 'Pop stack into register' },
    [OP.PUSH_I]:  { size: 5, format: 'imm32',   mnemonic: 'PUSH',    desc: 'Push 32-bit immediate onto stack' },
    [OP.CALL]:    { size: 3, format: 'addr16',   mnemonic: 'CALL',    desc: 'Call subroutine' },
    [OP.RET]:     { size: 1, format: 'none',     mnemonic: 'RET',     desc: 'Return from subroutine' },
    [OP.OUT]:     { size: 2, format: 'r',        mnemonic: 'OUT',     desc: 'Output register value' },
    [OP.OUT_I]:   { size: 5, format: 'imm32',   mnemonic: 'OUT',     desc: 'Output immediate value' },
    [OP.SYSCALL]: { size: 2, format: 'imm8',    mnemonic: 'SYSCALL', desc: 'System call' },
    [OP.HLT]:     { size: 1, format: 'none',     mnemonic: 'HLT',     desc: 'Halt CPU' },
};

// Register name mapping
const REG_NAMES = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7'];


// ============================================================================
// Memory — Observable memory with event emission (byte-addressable, 32-bit words)
// ============================================================================

class Memory {
    constructor(bus, size = MEMORY_SIZE) {
        this.bus = bus;
        this.size = size;
        this.data = new Uint8Array(size);
        this._regions = {
            code:  { start: CODE_START, end: DATA_START - 1, label: 'Code' },
            data:  { start: DATA_START, end: STACK_START - 64, label: 'Data' },
            stack: { start: STACK_START - 63, end: STACK_START + 3, label: 'Stack' },
        };
    }

    // Read a single byte
    read(address) {
        if (address < 0 || address >= this.size) {
            this.bus.emit('error', { type: 'memory', message: `Read out of bounds: 0x${address.toString(16).toUpperCase()}` });
            return 0;
        }
        this.bus.emit('memoryRead', { address, value: this.data[address] });
        return this.data[address];
    }

    // Write a single byte
    write(address, value) {
        if (address < 0 || address >= this.size) {
            this.bus.emit('error', { type: 'memory', message: `Write out of bounds: 0x${address.toString(16).toUpperCase()}` });
            return;
        }
        const oldValue = this.data[address];
        this.data[address] = value & 0xFF;
        this.bus.emit('memoryWrite', { address, value: this.data[address], oldValue });
    }

    // Read 32-bit word (little-endian)
    read32(address) {
        if (address < 0 || address + 3 >= this.size) {
            this.bus.emit('error', { type: 'memory', message: `Read32 out of bounds: 0x${address.toString(16).toUpperCase()}` });
            return 0;
        }
        const val = (this.data[address]) |
                    (this.data[address + 1] << 8) |
                    (this.data[address + 2] << 16) |
                    ((this.data[address + 3] << 24) >>> 0);  // >>> 0 to handle sign
        this.bus.emit('memoryRead', { address, value: val, width: 32 });
        return val | 0;  // Convert to signed 32-bit
    }

    // Write 32-bit word (little-endian)
    write32(address, value) {
        if (address < 0 || address + 3 >= this.size) {
            this.bus.emit('error', { type: 'memory', message: `Write32 out of bounds: 0x${address.toString(16).toUpperCase()}` });
            return;
        }
        const v = value | 0;
        this.data[address]     = v & 0xFF;
        this.data[address + 1] = (v >>> 8) & 0xFF;
        this.data[address + 2] = (v >>> 16) & 0xFF;
        this.data[address + 3] = (v >>> 24) & 0xFF;
        this.bus.emit('memoryWrite', { address, value: v, width: 32 });
    }

    // Read 16-bit word (little-endian)
    read16(address) {
        if (address < 0 || address + 1 >= this.size) return 0;
        return (this.data[address]) | (this.data[address + 1] << 8);
    }

    // Write 16-bit word (little-endian)
    write16(address, value) {
        if (address < 0 || address + 1 >= this.size) return;
        this.data[address]     = value & 0xFF;
        this.data[address + 1] = (value >> 8) & 0xFF;
    }

    // Read without emitting events (for visualization)
    peek(address) {
        if (address < 0 || address >= this.size) return 0;
        return this.data[address];
    }

    // Peek 32-bit without events
    peek32(address) {
        if (address < 0 || address + 3 >= this.size) return 0;
        return ((this.data[address]) |
                (this.data[address + 1] << 8) |
                (this.data[address + 2] << 16) |
                ((this.data[address + 3] << 24) >>> 0)) | 0;
    }

    // Peek 16-bit without events
    peek16(address) {
        if (address < 0 || address + 1 >= this.size) return 0;
        return (this.data[address]) | (this.data[address + 1] << 8);
    }

    // Write without emitting events (for loading programs)
    poke(address, value) {
        if (address < 0 || address >= this.size) return;
        this.data[address] = value & 0xFF;
    }

    // Poke 32-bit without events
    poke32(address, value) {
        if (address < 0 || address + 3 >= this.size) return;
        const v = value | 0;
        this.data[address]     = v & 0xFF;
        this.data[address + 1] = (v >>> 8) & 0xFF;
        this.data[address + 2] = (v >>> 16) & 0xFF;
        this.data[address + 3] = (v >>> 24) & 0xFF;
    }

    // Poke 16-bit without events
    poke16(address, value) {
        if (address < 0 || address + 1 >= this.size) return;
        this.data[address]     = value & 0xFF;
        this.data[address + 1] = (value >> 8) & 0xFF;
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
// Registers — Observable 32-bit register file
// ============================================================================

class Registers {
    constructor(bus, count = NUM_REGISTERS) {
        this.bus = bus;
        this.count = count;
        this.data = new Int32Array(count);
        this._pc = 0;
        this._sp = STACK_START;
    }

    get(index) {
        if (index < 0 || index >= this.count) {
            this.bus.emit('error', { type: 'register', message: `Invalid register: R${index}` });
            return 0;
        }
        return this.data[index];
    }

    set(index, value) {
        if (index < 0 || index >= this.count) {
            this.bus.emit('error', { type: 'register', message: `Invalid register: R${index}` });
            return;
        }
        const oldValue = this.data[index];
        this.data[index] = value | 0;  // Coerce to signed 32-bit
        this.bus.emit('registerChanged', {
            register: index,
            name: REG_NAMES[index],
            value: this.data[index],
            oldValue
        });
    }

    // Program Counter (16-bit address space for 4KB)
    get pc() { return this._pc; }
    set pc(value) {
        const oldValue = this._pc;
        this._pc = value & 0xFFFF;
        this.bus.emit('pcChanged', { value: this._pc, oldValue });
    }

    // Stack Pointer
    get sp() { return this._sp; }
    set sp(value) {
        const oldValue = this._sp;
        this._sp = value & 0xFFFF;
        this.bus.emit('spChanged', { value: this._sp, oldValue });
    }

    // Snapshot for debugger
    snapshot() {
        return {
            data: new Int32Array(this.data),
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

    // Update flags based on a 32-bit result
    update(result, a, b, isSub = false) {
        const r32 = result | 0;
        this.zero = (r32 === 0);
        this.negative = (r32 < 0);
        if (isSub) {
            // For subtraction, carry = borrow (unsigned a < unsigned b)
            this.carry = ((a >>> 0) < (b >>> 0));
            // Overflow: sign(a) != sign(b) and sign(result) != sign(a)
            this.overflow = (((a ^ b) & 0x80000000) !== 0) && (((a ^ r32) & 0x80000000) !== 0);
        } else {
            // For addition, carry = result overflows 32 bits unsigned
            const uResult = (a >>> 0) + (b >>> 0);
            this.carry = (uResult > 0xFFFFFFFF);
            this.overflow = (((~(a ^ b)) & (a ^ r32) & 0x80000000) !== 0);
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
// ALU — 32-bit Arithmetic Logic Unit
// ============================================================================

class ALU {
    constructor(bus) {
        this.bus = bus;
    }

    execute(operation, a, b = 0) {
        let result;
        let isSub = false;

        // Ensure 32-bit signed
        a = a | 0;
        b = b | 0;

        switch (operation) {
            case 'ADD':
                result = (a + b) | 0;
                break;
            case 'SUB':
                result = (a - b) | 0;
                isSub = true;
                break;
            case 'MUL':
                result = Math.imul(a, b);
                break;
            case 'DIV':
                if (b === 0) {
                    this.bus.emit('error', { type: 'alu', message: 'Division by zero' });
                    result = 0;
                } else {
                    result = (a / b) | 0;  // Integer division (truncate toward zero)
                }
                break;
            case 'MOD':
                if (b === 0) {
                    this.bus.emit('error', { type: 'alu', message: 'Modulo by zero' });
                    result = 0;
                } else {
                    result = (a % b) | 0;
                }
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
                result = (a << (b & 31));
                break;
            case 'SHR':
                result = (a >>> (b & 31));
                break;
            case 'INC':
                result = (a + 1) | 0;
                break;
            case 'DEC':
                result = (a - 1) | 0;
                isSub = true;
                b = 1;
                break;
            case 'NEG':
                result = (-a) | 0;
                isSub = true;
                b = a;
                a = 0;
                break;
            case 'CMP':
                result = (a - b) | 0;
                isSub = true;
                break;
            case 'PASS':
                result = a;
                break;
            default:
                this.bus.emit('error', { type: 'alu', message: `Unknown ALU operation: ${operation}` });
                result = 0;
        }

        this.bus.emit('aluOperation', {
            operation,
            operandA: a,
            operandB: b,
            result,
            isSub
        });

        return { result, isSub, a, b };
    }
}


// ============================================================================
// Assembler — Converts assembly instructions to 32-bit machine code
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
        const m = s.toUpperCase().match(/^R([0-7])$/);
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

    // Helper: push 32-bit little-endian value into bytes array
    _push32(bytes, value) {
        const v = value | 0;
        bytes.push(v & 0xFF);
        bytes.push((v >>> 8) & 0xFF);
        bytes.push((v >>> 16) & 0xFF);
        bytes.push((v >>> 24) & 0xFF);
    }

    // Helper: push 16-bit little-endian value into bytes array
    _push16(bytes, value) {
        bytes.push(value & 0xFF);
        bytes.push((value >> 8) & 0xFF);
    }

    _getInstructionSize(instr) {
        const mn = instr.mnemonic.toUpperCase();
        const ops = instr.operands || [];

        switch (mn) {
            case 'NOP': return 1;
            case 'HLT': return 1;
            case 'RET': return 1;
            case 'SYSCALL': return 2;
            case 'MOV':
                if (ops.length === 2) {
                    return this._parseRegister(ops[1]) >= 0 ? 2 : 6;
                }
                return -1;
            case 'LOAD':
                if (ops.length === 2) {
                    return this._parseRegister(ops[1]) >= 0 ? 2 : 4;
                }
                return -1;
            case 'STORE':
                if (ops.length === 2) {
                    return this._parseRegister(ops[1]) >= 0 ? 2 : 4;
                }
                return -1;
            case 'ADD': case 'SUB': case 'MUL': case 'DIV': case 'MOD':
                if (ops.length === 2) {
                    return this._parseRegister(ops[1]) >= 0 ? 2 : 6;
                }
                return -1;
            case 'AND': case 'OR':
                if (ops.length === 2) {
                    return this._parseRegister(ops[1]) >= 0 ? 2 : 6;
                }
                return -1;
            case 'XOR':
                return 2;
            case 'NOT': case 'INC': case 'DEC': case 'NEG':
                return 2;
            case 'SHL': case 'SHR':
                return 3;
            case 'CMP':
                if (ops.length === 2) {
                    return this._parseRegister(ops[1]) >= 0 ? 2 : 6;
                }
                return -1;
            case 'JMP': case 'JZ': case 'JNZ': case 'JG': case 'JL': case 'JGE': case 'JLE':
                return 3;
            case 'PUSH':
                return this._parseRegister(ops[0]) >= 0 ? 2 : 5;
            case 'POP':
                return 2;
            case 'CALL':
                return 3;
            case 'OUT':
                return this._parseRegister(ops[0]) >= 0 ? 2 : 5;
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

            case 'SYSCALL': {
                const id = this._parseImmediate(ops[0], labels);
                if (isNaN(id)) return { error: `SYSCALL: invalid id: ${ops[0]}` };
                bytes.push(OP.SYSCALL);
                bytes.push(id & 0xFF);
                break;
            }

            case 'MOV':
                if (rd < 0) return { error: `MOV: invalid destination register: ${ops[0]}` };
                if (rs >= 0) {
                    // MOV Rd, Rs
                    bytes.push(OP.MOV_RR);
                    bytes.push((rd << 4) | rs);
                } else {
                    // MOV Rd, #imm32
                    const imm = this._parseImmediate(ops[1], labels);
                    if (isNaN(imm)) return { error: `MOV: invalid immediate: ${ops[1]}` };
                    bytes.push(OP.MOV_RI);
                    bytes.push(rd);
                    this._push32(bytes, imm);
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
                    // LOAD Rd, [addr16]
                    const addr = this._parseImmediate(ops[1], labels);
                    if (isNaN(addr)) return { error: `LOAD: invalid address: ${ops[1]}` };
                    bytes.push(OP.LOAD);
                    bytes.push(rd);
                    this._push16(bytes, addr);
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
                    // STORE Rs, [addr16]
                    const addr2 = this._parseImmediate(ops[1], labels);
                    if (isNaN(addr2)) return { error: `STORE: invalid address: ${ops[1]}` };
                    bytes.push(OP.STORE);
                    bytes.push(srcReg2);
                    this._push16(bytes, addr2);
                }
                break;
            }

            case 'ADD': case 'SUB': case 'MUL': case 'DIV': case 'MOD': {
                if (rd < 0) return { error: `${mn}: invalid destination register: ${ops[0]}` };
                const opcodes = {
                    'ADD': [OP.ADD_RR, OP.ADD_RI],
                    'SUB': [OP.SUB_RR, OP.SUB_RI],
                    'MUL': [OP.MUL_RR, OP.MUL_RI],
                    'DIV': [OP.DIV_RR, OP.DIV_RI],
                    'MOD': [OP.MOD_RR, OP.MOD_RI],
                };
                if (rs >= 0) {
                    bytes.push(opcodes[mn][0]);
                    bytes.push((rd << 4) | rs);
                } else {
                    const imm = this._parseImmediate(ops[1], labels);
                    if (isNaN(imm)) return { error: `${mn}: invalid immediate: ${ops[1]}` };
                    bytes.push(opcodes[mn][1]);
                    bytes.push(rd);
                    this._push32(bytes, imm);
                }
                break;
            }

            case 'INC': case 'DEC': case 'NOT': case 'NEG': {
                if (rd < 0) return { error: `${mn}: invalid register: ${ops[0]}` };
                const opMap = { 'INC': OP.INC, 'DEC': OP.DEC, 'NOT': OP.NOT, 'NEG': OP.NEG };
                bytes.push(opMap[mn]);
                bytes.push(rd);
                break;
            }

            case 'AND': case 'OR': {
                if (rd < 0) return { error: `${mn}: invalid destination register: ${ops[0]}` };
                if (rs >= 0) {
                    const logicMap = { 'AND': OP.AND_RR, 'OR': OP.OR_RR };
                    bytes.push(logicMap[mn]);
                    bytes.push((rd << 4) | rs);
                } else {
                    const imm = this._parseImmediate(ops[1], labels);
                    if (isNaN(imm)) return { error: `${mn}: invalid immediate: ${ops[1]}` };
                    const logicImmMap = { 'AND': OP.AND_RI, 'OR': OP.OR_RI };
                    bytes.push(logicImmMap[mn]);
                    bytes.push(rd);
                    this._push32(bytes, imm);
                }
                break;
            }

            case 'XOR': {
                if (rd < 0 || rs < 0) return { error: `XOR: requires two registers` };
                bytes.push(OP.XOR_RR);
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
                    this._push32(bytes, imm);
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
                this._push16(bytes, target);
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
                    this._push32(bytes, imm);
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
                this._push16(bytes, target);
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
                    this._push32(bytes, imm);
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
     * Disassemble bytes starting at an address
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
                const rd = (byte2 >> 4) & 0x07;
                const rs = byte2 & 0x07;
                if (opcode === OP.LOAD_RR) {
                    text += ` R${rd}, [R${rs}]`;
                } else if (opcode === OP.STORE_RR) {
                    text += ` R${rs}, [R${rd}]`;
                } else {
                    text += ` R${rd}, R${rs}`;
                }
                break;
            }
            case 'ri32': {
                const rd = memory.peek(address + 1) & 0x07;
                const imm = memory.peek32(address + 2);
                text += ` R${rd}, ${imm}`;
                break;
            }
            case 'ri8': {
                const rd = memory.peek(address + 1) & 0x07;
                const imm = memory.peek(address + 2);
                text += ` R${rd}, ${imm}`;
                break;
            }
            case 'ra16': {
                const rd = memory.peek(address + 1) & 0x07;
                const addr = memory.peek16(address + 2);
                if (opcode === OP.STORE) {
                    text += ` R${rd}, [0x${addr.toString(16).toUpperCase().padStart(3, '0')}]`;
                } else {
                    text += ` R${rd}, [0x${addr.toString(16).toUpperCase().padStart(3, '0')}]`;
                }
                break;
            }
            case 'r': {
                const rd = memory.peek(address + 1) & 0x07;
                text += ` R${rd}`;
                break;
            }
            case 'addr16': {
                const addr = memory.peek16(address + 1);
                text += ` 0x${addr.toString(16).toUpperCase().padStart(3, '0')}`;
                break;
            }
            case 'imm32': {
                const imm = memory.peek32(address + 1);
                text += ` ${imm}`;
                break;
            }
            case 'imm8': {
                const imm = memory.peek(address + 1);
                text += ` ${imm}`;
                break;
            }
        }

        return { text, size };
    }
}


// ============================================================================
// CPU — The 32-bit processor
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
        this._maxCycles = 50000; // Safety limit (higher for 32-bit programs)
        this._breakpoints = new Set();
        this._trace = [];
        this._maxTrace = 500;
        this._snapshots = [];
        this._maxSnapshots = 200;
        this._speed = 5;
        this._animationFrame = null;
        this._programEnd = 0;

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
        this._snapshots = this._snapshots.slice(0, index + 1);
        this._trace = this._trace.filter(t => t.cycle <= snap.cycle);
        this.bus.emit('snapshotRestored', { cycle: snap.cycle, index });
        return true;
    }

    get snapshots() { return this._snapshots; }

    // Helper to format addresses
    _fmtAddr(addr) {
        return '0x' + (addr & 0xFFFF).toString(16).toUpperCase().padStart(3, '0');
    }

    // Helper to format 32-bit values
    _fmtVal(val) {
        return val.toString();
    }

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
                const rd = (byte2 >> 4) & 0x07;
                const rs = byte2 & 0x07;
                const val = this.registers.get(rs);
                this.registers.set(rd, val);
                text = `MOV R${rd}, R${rs}`;
                description = `R${rd} = R${rs} = ${val}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.MOV_RI: {
                const rd = this.memory.peek(pc + 1) & 0x07;
                const imm = this.memory.peek32(pc + 2);
                this.registers.set(rd, imm);
                text = `MOV R${rd}, ${imm}`;
                description = `R${rd} = ${imm}`;
                changes.rd = rd;
                this.registers.pc = pc + 6;
                break;
            }

            case OP.LOAD: {
                const rd = this.memory.peek(pc + 1) & 0x07;
                const addr = this.memory.peek16(pc + 2);
                const val = this.memory.read32(addr);
                this.registers.set(rd, val);
                text = `LOAD R${rd}, [${this._fmtAddr(addr)}]`;
                description = `R${rd} = mem[${this._fmtAddr(addr)}] = ${val}`;
                changes.rd = rd;
                changes.memRead = addr;
                this.registers.pc = pc + 4;
                break;
            }

            case OP.STORE: {
                const rs = this.memory.peek(pc + 1) & 0x07;
                const addr = this.memory.peek16(pc + 2);
                const val = this.registers.get(rs);
                this.memory.write32(addr, val);
                text = `STORE R${rs}, [${this._fmtAddr(addr)}]`;
                description = `mem[${this._fmtAddr(addr)}] = R${rs} = ${val}`;
                changes.memWrite = addr;
                this.registers.pc = pc + 4;
                break;
            }

            case OP.LOAD_RR: {
                const byte2 = this.memory.peek(pc + 1);
                const rd = (byte2 >> 4) & 0x07;
                const rs = byte2 & 0x07;
                const addr = this.registers.get(rs) & 0xFFFF;
                const val = this.memory.read32(addr);
                this.registers.set(rd, val);
                text = `LOAD R${rd}, [R${rs}]`;
                description = `R${rd} = mem[R${rs}] = mem[${this._fmtAddr(addr)}] = ${val}`;
                changes.rd = rd;
                changes.memRead = addr;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.STORE_RR: {
                const byte2 = this.memory.peek(pc + 1);
                const rd = (byte2 >> 4) & 0x07;
                const rs = byte2 & 0x07;
                const val = this.registers.get(rs);
                const addr = this.registers.get(rd) & 0xFFFF;
                this.memory.write32(addr, val);
                text = `STORE R${rs}, [R${rd}]`;
                description = `mem[R${rd}] = mem[${this._fmtAddr(addr)}] = R${rs} = ${val}`;
                changes.memWrite = addr;
                this.registers.pc = pc + 2;
                break;
            }

            // Arithmetic: register-register
            case OP.ADD_RR: case OP.SUB_RR: case OP.MUL_RR: case OP.DIV_RR: case OP.MOD_RR: {
                const byte2 = this.memory.peek(pc + 1);
                const rd = (byte2 >> 4) & 0x07;
                const rs = byte2 & 0x07;
                const a = this.registers.get(rd);
                const b = this.registers.get(rs);
                const opName = {
                    [OP.ADD_RR]: 'ADD', [OP.SUB_RR]: 'SUB', [OP.MUL_RR]: 'MUL',
                    [OP.DIV_RR]: 'DIV', [OP.MOD_RR]: 'MOD'
                }[opcode];
                const sym = { 'ADD': '+', 'SUB': '-', 'MUL': '*', 'DIV': '/', 'MOD': '%' }[opName];
                const aluResult = this.alu.execute(opName, a, b);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.result, a, b, aluResult.isSub);
                text = `${opName} R${rd}, R${rs}`;
                description = `R${rd} = ${a} ${sym} ${b} = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            // Arithmetic: register-immediate
            case OP.ADD_RI: case OP.SUB_RI: case OP.MUL_RI: case OP.DIV_RI: case OP.MOD_RI: {
                const rd = this.memory.peek(pc + 1) & 0x07;
                const imm = this.memory.peek32(pc + 2);
                const a = this.registers.get(rd);
                const opName = {
                    [OP.ADD_RI]: 'ADD', [OP.SUB_RI]: 'SUB', [OP.MUL_RI]: 'MUL',
                    [OP.DIV_RI]: 'DIV', [OP.MOD_RI]: 'MOD'
                }[opcode];
                const sym = { 'ADD': '+', 'SUB': '-', 'MUL': '*', 'DIV': '/', 'MOD': '%' }[opName];
                const aluResult = this.alu.execute(opName, a, imm);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.result, a, imm, aluResult.isSub);
                text = `${opName} R${rd}, ${imm}`;
                description = `R${rd} = ${a} ${sym} ${imm} = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 6;
                break;
            }

            case OP.INC: {
                const rd = this.memory.peek(pc + 1) & 0x07;
                const a = this.registers.get(rd);
                const aluResult = this.alu.execute('INC', a);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.result, a, 1, false);
                text = `INC R${rd}`;
                description = `R${rd} = ${a} + 1 = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.DEC: {
                const rd = this.memory.peek(pc + 1) & 0x07;
                const a = this.registers.get(rd);
                const aluResult = this.alu.execute('DEC', a);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.result, a, 1, true);
                text = `DEC R${rd}`;
                description = `R${rd} = ${a} - 1 = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.NEG: {
                const rd = this.memory.peek(pc + 1) & 0x07;
                const a = this.registers.get(rd);
                const aluResult = this.alu.execute('NEG', a);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.result, 0, a, true);
                text = `NEG R${rd}`;
                description = `R${rd} = -${a} = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            // Logic
            case OP.AND_RR: case OP.OR_RR: case OP.XOR_RR: {
                const byte2 = this.memory.peek(pc + 1);
                const rd = (byte2 >> 4) & 0x07;
                const rs = byte2 & 0x07;
                const a = this.registers.get(rd);
                const b = this.registers.get(rs);
                const opName = opcode === OP.AND_RR ? 'AND' : opcode === OP.OR_RR ? 'OR' : 'XOR';
                const aluResult = this.alu.execute(opName, a, b);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.result, a, b);
                text = `${opName} R${rd}, R${rs}`;
                const sym = opName === 'AND' ? '&' : opName === 'OR' ? '|' : '^';
                description = `R${rd} = ${a} ${sym} ${b} = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.AND_RI: case OP.OR_RI: {
                const rd = this.memory.peek(pc + 1) & 0x07;
                const imm = this.memory.peek32(pc + 2);
                const a = this.registers.get(rd);
                const opName = opcode === OP.AND_RI ? 'AND' : 'OR';
                const aluResult = this.alu.execute(opName, a, imm);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.result, a, imm);
                text = `${opName} R${rd}, ${imm}`;
                const sym = opName === 'AND' ? '&' : '|';
                description = `R${rd} = ${a} ${sym} ${imm} = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 6;
                break;
            }

            case OP.NOT: {
                const rd = this.memory.peek(pc + 1) & 0x07;
                const a = this.registers.get(rd);
                const aluResult = this.alu.execute('NOT', a);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.result, a, 0);
                text = `NOT R${rd}`;
                description = `R${rd} = ~${a} = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.SHL: case OP.SHR: {
                const rd = this.memory.peek(pc + 1) & 0x07;
                const imm = this.memory.peek(pc + 2);
                const a = this.registers.get(rd);
                const opName = opcode === OP.SHL ? 'SHL' : 'SHR';
                const aluResult = this.alu.execute(opName, a, imm);
                this.registers.set(rd, aluResult.result);
                this.flags.update(aluResult.result, a, imm);
                text = `${opName} R${rd}, ${imm}`;
                description = `R${rd} = ${a} ${opName === 'SHL' ? '<<' : '>>'} ${imm} = ${aluResult.result}`;
                changes.rd = rd;
                this.registers.pc = pc + 3;
                break;
            }

            // Comparison
            case OP.CMP_RR: {
                const byte2 = this.memory.peek(pc + 1);
                const rd = (byte2 >> 4) & 0x07;
                const rs = byte2 & 0x07;
                const a = this.registers.get(rd);
                const b = this.registers.get(rs);
                const aluResult = this.alu.execute('CMP', a, b);
                this.flags.update(aluResult.result, a, b, true);
                text = `CMP R${rd}, R${rs}`;
                description = `Compare ${a} - ${b} = ${aluResult.result} ${this.flags.toString()}`;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.CMP_RI: {
                const rd = this.memory.peek(pc + 1) & 0x07;
                const imm = this.memory.peek32(pc + 2);
                const a = this.registers.get(rd);
                const aluResult = this.alu.execute('CMP', a, imm);
                this.flags.update(aluResult.result, a, imm, true);
                text = `CMP R${rd}, ${imm}`;
                description = `Compare ${a} - ${imm} = ${aluResult.result} ${this.flags.toString()}`;
                this.registers.pc = pc + 6;
                break;
            }

            // Branching
            case OP.JMP: {
                const addr = this.memory.peek16(pc + 1);
                this.registers.pc = addr;
                text = `JMP ${this._fmtAddr(addr)}`;
                description = `PC = ${this._fmtAddr(addr)}`;
                break;
            }

            case OP.JZ: {
                const addr = this.memory.peek16(pc + 1);
                text = `JZ ${this._fmtAddr(addr)}`;
                if (this.flags.zero) {
                    this.registers.pc = addr;
                    description = `ZF=1 → Jump to ${this._fmtAddr(addr)}`;
                } else {
                    this.registers.pc = pc + 3;
                    description = `ZF=0 → No jump`;
                }
                break;
            }

            case OP.JNZ: {
                const addr = this.memory.peek16(pc + 1);
                text = `JNZ ${this._fmtAddr(addr)}`;
                if (!this.flags.zero) {
                    this.registers.pc = addr;
                    description = `ZF=0 → Jump to ${this._fmtAddr(addr)}`;
                } else {
                    this.registers.pc = pc + 3;
                    description = `ZF=1 → No jump`;
                }
                break;
            }

            case OP.JG: {
                const addr = this.memory.peek16(pc + 1);
                text = `JG ${this._fmtAddr(addr)}`;
                if (!this.flags.zero && !this.flags.negative) {
                    this.registers.pc = addr;
                    description = `Greater → Jump`;
                } else {
                    this.registers.pc = pc + 3;
                    description = `Not greater → No jump`;
                }
                break;
            }

            case OP.JL: {
                const addr = this.memory.peek16(pc + 1);
                text = `JL ${this._fmtAddr(addr)}`;
                if (this.flags.negative) {
                    this.registers.pc = addr;
                    description = `Less → Jump`;
                } else {
                    this.registers.pc = pc + 3;
                    description = `Not less → No jump`;
                }
                break;
            }

            case OP.JGE: {
                const addr = this.memory.peek16(pc + 1);
                text = `JGE ${this._fmtAddr(addr)}`;
                if (this.flags.zero || !this.flags.negative) {
                    this.registers.pc = addr;
                    description = `Greater or equal → Jump`;
                } else {
                    this.registers.pc = pc + 3;
                    description = `Less → No jump`;
                }
                break;
            }

            case OP.JLE: {
                const addr = this.memory.peek16(pc + 1);
                text = `JLE ${this._fmtAddr(addr)}`;
                if (this.flags.zero || this.flags.negative) {
                    this.registers.pc = addr;
                    description = `Less or equal → Jump`;
                } else {
                    this.registers.pc = pc + 3;
                    description = `Greater → No jump`;
                }
                break;
            }

            // Stack (32-bit push/pop)
            case OP.PUSH: {
                const rs = this.memory.peek(pc + 1) & 0x07;
                const val = this.registers.get(rs);
                const sp = this.registers.sp - WORD_SIZE;
                this.registers.sp = sp;
                this.memory.write32(sp, val);
                text = `PUSH R${rs}`;
                description = `SP=${this._fmtAddr(sp)}, mem[SP] = R${rs} = ${val}`;
                changes.memWrite = sp;
                this.registers.pc = pc + 2;
                break;
            }

            case OP.PUSH_I: {
                const imm = this.memory.peek32(pc + 1);
                const sp = this.registers.sp - WORD_SIZE;
                this.registers.sp = sp;
                this.memory.write32(sp, imm);
                text = `PUSH ${imm}`;
                description = `SP=${this._fmtAddr(sp)}, mem[SP] = ${imm}`;
                changes.memWrite = sp;
                this.registers.pc = pc + 5;
                break;
            }

            case OP.POP: {
                const rd = this.memory.peek(pc + 1) & 0x07;
                const sp = this.registers.sp;
                const val = this.memory.read32(sp);
                this.registers.set(rd, val);
                this.registers.sp = sp + WORD_SIZE;
                text = `POP R${rd}`;
                description = `R${rd} = mem[${this._fmtAddr(sp)}] = ${val}, SP=${this._fmtAddr(sp + WORD_SIZE)}`;
                changes.rd = rd;
                changes.memRead = sp;
                this.registers.pc = pc + 2;
                break;
            }

            // Subroutines
            case OP.CALL: {
                const addr = this.memory.peek16(pc + 1);
                const returnAddr = pc + 3;
                const sp = this.registers.sp - WORD_SIZE;
                this.registers.sp = sp;
                this.memory.write32(sp, returnAddr);
                this.registers.pc = addr;
                text = `CALL ${this._fmtAddr(addr)}`;
                description = `Push return ${this._fmtAddr(returnAddr)}, jump to ${this._fmtAddr(addr)}`;
                changes.memWrite = sp;
                break;
            }

            case OP.RET: {
                const sp = this.registers.sp;
                const returnAddr = this.memory.read32(sp);
                this.registers.sp = sp + WORD_SIZE;
                this.registers.pc = returnAddr & 0xFFFF;
                text = `RET`;
                description = `Return to ${this._fmtAddr(returnAddr)}`;
                changes.memRead = sp;
                break;
            }

            // I/O
            case OP.OUT: {
                const rs = this.memory.peek(pc + 1) & 0x07;
                const val = this.registers.get(rs);
                this._output.push(val);
                text = `OUT R${rs}`;
                description = `Output R${rs} = ${val}`;
                this.bus.emit('output', { value: val, source: `R${rs}`, type: 'int' });
                this.registers.pc = pc + 2;
                break;
            }

            case OP.OUT_I: {
                const imm = this.memory.peek32(pc + 1);
                this._output.push(imm);
                text = `OUT ${imm}`;
                description = `Output ${imm}`;
                this.bus.emit('output', { value: imm, source: 'immediate', type: 'int' });
                this.registers.pc = pc + 5;
                break;
            }

            // System call
            case OP.SYSCALL: {
                const id = this.memory.peek(pc + 1);
                text = `SYSCALL ${id}`;
                switch (id) {
                    case 0x01: {
                        // Print integer from R0
                        const val = this.registers.get(0);
                        this._output.push(val);
                        description = `Print integer: R0 = ${val}`;
                        this.bus.emit('output', { value: val, source: 'R0', type: 'int' });
                        break;
                    }
                    case 0x02: {
                        // Print string from memory at address in R0
                        const addr = this.registers.get(0) & 0xFFFF;
                        let str = '';
                        let i = addr;
                        while (i < this.memory.size && this.memory.peek(i) !== 0) {
                            str += String.fromCharCode(this.memory.peek(i));
                            i++;
                            if (str.length > 256) break; // Safety limit
                        }
                        description = `Print string at ${this._fmtAddr(addr)}: "${str}"`;
                        this.bus.emit('output', { value: str, source: 'memory', type: 'string' });
                        break;
                    }
                    case 0x03: {
                        // Print char from R0
                        const ch = this.registers.get(0) & 0xFF;
                        description = `Print char: '${String.fromCharCode(ch)}'`;
                        this.bus.emit('output', { value: String.fromCharCode(ch), source: 'R0', type: 'char' });
                        break;
                    }
                    case 0x04: {
                        // Print newline
                        description = `Print newline`;
                        this.bus.emit('output', { value: '\n', source: 'system', type: 'newline' });
                        break;
                    }
                    default:
                        description = `Unknown syscall: ${id}`;
                        this.bus.emit('error', { type: 'syscall', message: `Unknown syscall: ${id}` });
                }
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

        if (this._speed >= 100) {
            const stepsPerFrame = Math.min(this._speed, 500);
            for (let i = 0; i < stepsPerFrame; i++) {
                if (!this.step()) {
                    this._running = false;
                    this.bus.emit('cpuStopped', { cycle: this._cycleCount });
                    return;
                }
                if (this._breakpoints.has(this.registers.pc)) {
                    this._running = false;
                    this.bus.emit('breakpointHit', { pc: this.registers.pc, cycle: this._cycleCount });
                    this.bus.emit('cpuStopped', { cycle: this._cycleCount });
                    return;
                }
            }
            this._animationFrame = requestAnimationFrame(() => this._runLoop());
        } else {
            if (!this.step()) {
                this._running = false;
                this.bus.emit('cpuStopped', { cycle: this._cycleCount });
                return;
            }
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
    WORD_SIZE,
};
