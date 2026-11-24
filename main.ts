// Tiny stack VM, make.fun tiny-stack-vm-01. Faithful to generator/subject/ISA.md
// and vm.mjs: exact 32-bit wrap, unsigned ops, shifts masked to 5 bits, and
// all ten traps with their own exit codes. Baseline plain-vm gets these wrong.
// Trap order per step: step limit (10), pc outside (9), unknown opcode (5),
// truncated immediate (9), then stack needs (2/3), then the op's own trap.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function run(p: Uint8Array, inp: Uint8Array): { out: Uint8Array; code: number } {
  const D = new Int32Array(256);
  const C = new Int32Array(64);
  const M = new Int32Array(256);
  const out = new Uint8Array(65536);
  let sp = 0, csp = 0, pc = 0, steps = 0, ip = 0, olen = 0;
  const done = (code: number) => ({ out: out.slice(0, olen), code });
  for (;;) {
    if (steps === 1000000) return done(10);
    if (pc < 0 || pc >= p.length) return done(9);
    const op = p[pc];
    // immediate length per opcode, -1 = unknown opcode
    let imm = 0;
    if (op === 0x01) imm = 1;
    else if (op === 0x02) imm = 4;
    else if (op === 0x30 || op === 0x31 || op === 0x32 || op === 0x33) imm = 2;
    else if (
      op === 0x00 || op === 0x03 || op === 0x04 || op === 0x05 || op === 0x06 || op === 0x07 ||
      (op >= 0x10 && op <= 0x22) || op === 0x34 || op === 0x40 || op === 0x41 ||
      op === 0x50 || op === 0x51 || op === 0x52 || op === 0x53
    ) imm = 0;
    else return done(5);
    if (pc + imm >= p.length) return done(9);
    steps++;
    const next = pc + 1 + imm;
    pc = next;
    switch (op) {
      case 0x00: return done(0);
      case 0x01:
        if (sp >= 256) return done(3);
        D[sp++] = (p[next - 1] << 24) >> 24;
        break;
      case 0x02:
        if (sp >= 256) return done(3);
        D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24);
        break;
      case 0x03:
        if (sp < 1) return done(2);
        sp--;
        break;
      case 0x04:
        if (sp < 1 || sp >= 256) return done(sp < 1 ? 2 : 3);
        D[sp] = D[sp - 1]; sp++;
        break;
      case 0x05:
        if (sp < 2) return done(2);
        { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; }
        break;
      case 0x06:
        if (sp < 2 || sp >= 256) return done(sp < 2 ? 2 : 3);
        D[sp] = D[sp - 2]; sp++;
        break;
      case 0x07:
        if (sp < 3) return done(2);
        { const a = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = a; }
        break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        if (sp < 2) return done(2);
        const b = D[sp - 1], a = D[sp - 2];
        let r: number;
        if (op === 0x10) r = (a + b) | 0;
        else if (op === 0x11) r = (a - b) | 0;
        else if (op === 0x12) r = Math.imul(a, b);
        else if (op === 0x13) {
          if (b === 0) return done(4);
          r = a === -2147483648 && b === -1 ? a : Math.trunc(a / b) | 0;
        } else if (op === 0x14) {
          if (b === 0) return done(4);
          r = b === -1 ? 0 : (a % b) | 0;
        } else if (op === 0x15) {
          if (b === 0) return done(4);
          r = Math.floor((a >>> 0) / (b >>> 0)) | 0;
        } else if (op === 0x16) {
          if (b === 0) return done(4);
          r = ((a >>> 0) % (b >>> 0)) | 0;
        } else if (op === 0x18) r = a & b;
        else if (op === 0x19) r = a | b;
        else if (op === 0x1a) r = a ^ b;
        else if (op === 0x1c) r = a << (b & 31);
        else if (op === 0x1d) r = a >> (b & 31);
        else if (op === 0x1e) r = (a >>> (b & 31)) | 0;
        else if (op === 0x20) r = a === b ? 1 : 0;
        else if (op === 0x21) r = a < b ? 1 : 0;
        else r = (a >>> 0) < (b >>> 0) ? 1 : 0;
        sp -= 2; D[sp++] = r;
        break;
      }
      case 0x17:
        if (sp < 1) return done(2);
        D[sp - 1] = -D[sp - 1] | 0;
        break;
      case 0x1b:
        if (sp < 1) return done(2);
        D[sp - 1] = ~D[sp - 1];
        break;
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) {
          if (sp < 1) return done(2);
          const v = D[--sp];
          take = op === 0x31 ? v === 0 : v !== 0;
        }
        if (take) pc = next + rel;
        break;
      }
      case 0x33:
        if (csp === 64) return done(7);
        C[csp++] = next;
        pc = p[next - 2] | (p[next - 1] << 8);
        break;
      case 0x34:
        if (csp === 0) return done(8);
        pc = C[--csp];
        break;
      case 0x40: {
        if (sp < 1) return done(2);
        const addr = D[sp - 1];
        if (addr < 0 || addr >= 256) return done(6);
        D[sp - 1] = M[addr];
        break;
      }
      case 0x41: {
        if (sp < 2) return done(2);
        const addr = D[sp - 1], v = D[sp - 2];
        if (addr < 0 || addr >= 256) return done(6);
        sp -= 2; M[addr] = v;
        break;
      }
      case 0x50: {
        if (sp < 1) return done(2);
        const s = String(D[sp - 1]);
        if (olen + s.length > 65536) return done(11);
        sp--;
        for (let i = 0; i < s.length; i++) out[olen++] = s.charCodeAt(i);
        break;
      }
      case 0x51:
        if (sp < 1) return done(2);
        if (olen + 1 > 65536) return done(11);
        out[olen++] = D[--sp] & 255;
        break;
      case 0x52:
        if (sp >= 256) return done(3);
        D[sp++] = ip < inp.length ? inp[ip++] : -1;
        break;
      case 0x53:
        if (sp < 1) return done(2);
        return done(D[--sp] & 255);
      default:
        return done(5);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))), new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.out);
  writeFileSync(join(O, id, 'exit.txt'), `${r.code}\n`);
}
