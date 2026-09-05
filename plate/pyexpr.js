/* A parser for Python expressions, so a formula in config/derived.csv is read the way
   ast.parse(expr, mode="eval") reads it and refused for the same reason with the same words.

   derived.py evaluates a formula by walking Python's own syntax tree and rejecting every node
   that is not a number, a name, +x, -x, the four operators, ** or a call to one of eight
   functions. The refusal names the node ("expression element not allowed in a formula:
   Attribute"), and a formula that does not parse quotes Python's SyntaxError ("unexpected EOF
   while parsing"). To say the same thing here, this file tokenizes the way Python 3.9's
   tokenizer does (numbers, strings, names, comments, indentation, brackets, the errors each
   raises) and parses the full expression grammar, producing nodes with Python's node names.
   Nothing here evaluates; derived.js does that on the tree. */
import { PyValueError } from './py.js';

export class PySyntaxError extends Error {
  constructor(msg, lineno) {
    super(msg + ' (<unknown>, line ' + lineno + ')');
    this.name = 'SyntaxError'; this.msg = msg; this.lineno = lineno;
  }
}

const KEYWORDS = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class',
  'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
  'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);
const TWO_CHAR = new Set(['!=', '%=', '&=', '**', '*=', '+=', '-=', '->', '//', '/=', ':=', '<<', '<=', '<>', '==', '>=', '>>', '@=', '^=', '|=']);
const THREE_CHAR = new Set(['**=', '//=', '<<=', '>>=']);
const ID_START = /^[\p{ID_Start}_]$/u;
const ID_CONTINUE = /^\p{ID_Continue}$/u;
const NOT_PRINTABLE = /^[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]$/u;

/* str.isprintable() for one character */
export function isPrintable(ch) { return ch === ' ' || !NOT_PRINTABLE.test(ch); }

/* repr(str) as Python prints it, non-printable characters escaped. */
export function reprStr(s) {
  s = String(s);
  const q = (s.includes("'") && !s.includes('"')) ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (ch === q || ch === '\\') out += '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (cp < 0x20 || cp === 0x7f) out += '\\x' + cp.toString(16).padStart(2, '0');
    else if (cp < 0x7f || isPrintable(ch)) out += ch;
    else if (cp <= 0xff) out += '\\x' + cp.toString(16).padStart(2, '0');
    else if (cp <= 0xffff) out += '\\u' + cp.toString(16).padStart(4, '0');
    else out += '\\U' + cp.toString(16).padStart(8, '0');
  }
  return out + q;
}

const isDigit = c => c !== null && c >= '0' && c <= '9';
const isXDigit = c => c !== null && /[0-9a-fA-F]/.test(c);
const isIdStart = c => c !== null && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c > '\x7f');
const isIdChar = c => isIdStart(c) || isDigit(c);

/* The tokenizer: Parser/tokenizer.c's tok_get, one token per call, with the same look-ahead,
   so that "has the tokenizer reached the end of the input" -- which decides between
   "unexpected EOF while parsing" and "invalid syntax" -- comes out the same. */
class Tokenizer {
  constructor(src) {
    this.src = src; this.n = src.length; this.pos = 0;
    this.line = 0; this.maxRead = -1; this.eof = false;
    this.level = 0; this.parens = [];
    this.atbol = true; this.pendin = 0;
  }
  nextc() {
    if (this.pos >= this.n) { this.eof = true; this.pos++; return null; }
    while (this.maxRead < this.pos) { this.maxRead++; if (this.maxRead === 0 || this.src[this.maxRead - 1] === '\n') this.line++; }
    return this.src[this.pos++];
  }
  backup() { this.pos--; }
  tok(type, value, line) { return { type, value: value === undefined ? null : value, line: line === undefined ? this.line : line, eof: this.eof }; }
  err(msg) { return { type: 'ERROR', msg, line: this.line, eof: this.eof }; }

  get() {
    for (;;) {                                                     // nextline
      let blankline = false;
      if (this.atbol) {
        this.atbol = false;
        let col = 0, c;
        for (;;) {
          c = this.nextc();
          if (c === ' ') col++;
          else if (c === '\t') col = (Math.floor(col / 8) + 1) * 8;
          else if (c === '\f') col = 0;
          else break;
        }
        this.backup();
        if (c === '#' || c === '\n' || c === '\\') blankline = true;
        if (!blankline && this.level === 0 && col > 0) this.pendin++;   // the indent stack holds only 0 in eval mode
      }
      if (this.pendin > 0) { this.pendin--; return this.tok('INDENT'); }
      for (;;) {                                                   // again
        let c;
        do { c = this.nextc(); } while (c === ' ' || c === '\t' || c === '\f');
        const start = this.pos - 1;
        if (c === '#') { while (c !== null && c !== '\n') c = this.nextc(); }
        if (c === null) return this.tok('ENDMARKER');
        if (isIdStart(c)) {
          let sawB = false, sawR = false, sawU = false, sawF = false;
          for (;;) {
            if (!(sawB || sawU || sawF) && (c === 'b' || c === 'B')) sawB = true;
            else if (!(sawB || sawU || sawR || sawF) && (c === 'u' || c === 'U')) sawU = true;
            else if (!(sawR || sawU) && (c === 'r' || c === 'R')) sawR = true;
            else if (!(sawF || sawB || sawU) && (c === 'f' || c === 'F')) sawF = true;
            else break;
            c = this.nextc();
            if (c === '"' || c === "'") return this.string(c, start, { bytes: sawB, fstring: sawF });
          }
          while (isIdChar(c)) c = this.nextc();
          this.backup();
          const line = this.line;
          const text = this.src.slice(start, this.pos);
          if (/[^\x00-\x7f]/.test(text)) {
            const bad = verifyIdentifier(text);
            if (bad) return this.err(bad);
            return this.tok('NAME', text.normalize('NFKC'), line);
          }
          return this.tok(KEYWORDS.has(text) ? 'KW' : 'NAME', text, line);
        }
        if (c === '\n') {
          this.atbol = true;
          if (blankline || this.level > 0) break;                  // goto nextline
          return this.tok('NEWLINE');
        }
        if (c === '.') {
          c = this.nextc();
          if (isDigit(c)) return this.number(start, 'fraction', c);
          if (c === '.') {
            c = this.nextc();
            if (c === '.') return this.tok('OP', '...');
            this.backup(); this.backup();
          } else this.backup();
          return this.tok('OP', '.');
        }
        if (isDigit(c)) return this.number(start, 'digit', c);
        if (c === "'" || c === '"') return this.string(c, start, { bytes: false, fstring: false });
        if (c === '\\') {
          c = this.nextc();
          if (c !== '\n') return this.err('unexpected character after line continuation character');
          c = this.nextc();
          if (c === null) return this.err('unexpected EOF while parsing');
          this.backup();
          continue;                                                // goto again
        }
        const c2 = this.nextc();
        if (c2 !== null && TWO_CHAR.has(c + c2)) {
          const c3 = this.nextc();
          if (c3 !== null && THREE_CHAR.has(c + c2 + c3)) return this.tok('OP', c + c2 + c3);
          this.backup();
          return this.tok('OP', c + c2);
        }
        this.backup();
        if (c === '(' || c === '[' || c === '{') {
          this.parens.push({ ch: c, line: this.line }); this.level++;
        } else if (c === ')' || c === ']' || c === '}') {
          if (!this.level) return this.err("unmatched '" + c + "'");
          this.level--;
          const open = this.parens.pop();
          const ok = (open.ch === '(' && c === ')') || (open.ch === '[' && c === ']') || (open.ch === '{' && c === '}');
          if (!ok) {
            const where = open.line !== this.line ? ' on line ' + open.line : '';
            return this.err("closing parenthesis '" + c + "' does not match opening parenthesis '" + open.ch + "'" + where);
          }
        }
        return this.tok('OP', c);
      }
    }
  }

  /* the number branch of tok_get; c is the digit already read, or the digit after a leading '.' */
  number(start, mode, c) {
    const decimalTail = () => {                                    // tok_decimal_tail
      for (;;) {
        do { c = this.nextc(); } while (isDigit(c));
        if (c !== '_') return true;
        c = this.nextc();
        if (!isDigit(c)) { this.backup(); return false; }
      }
    };
    const finish = () => { this.backup(); return this.tok('NUMBER', this.src.slice(start, this.pos)); };
    const invalidDecimal = () => this.err('invalid decimal literal');
    let state = mode;
    if (state === 'digit') {
      if (c === '0') {
        c = this.nextc();
        if (c === 'x' || c === 'X') {
          c = this.nextc();
          do {
            if (c === '_') c = this.nextc();
            if (!isXDigit(c)) { this.backup(); return this.err('invalid hexadecimal literal'); }
            do { c = this.nextc(); } while (isXDigit(c));
          } while (c === '_');
          return finish();
        }
        if (c === 'o' || c === 'O') {
          c = this.nextc();
          do {
            if (c === '_') c = this.nextc();
            if (c === null || c < '0' || c >= '8') {
              this.backup();
              return isDigit(c) ? this.err("invalid digit '" + c + "' in octal literal") : this.err('invalid octal literal');
            }
            do { c = this.nextc(); } while (c !== null && c >= '0' && c < '8');
          } while (c === '_');
          if (isDigit(c)) return this.err("invalid digit '" + c + "' in octal literal");
          return finish();
        }
        if (c === 'b' || c === 'B') {
          c = this.nextc();
          do {
            if (c === '_') c = this.nextc();
            if (c !== '0' && c !== '1') {
              this.backup();
              return isDigit(c) ? this.err("invalid digit '" + c + "' in binary literal") : this.err('invalid binary literal');
            }
            do { c = this.nextc(); } while (c === '0' || c === '1');
          } while (c === '_');
          if (isDigit(c)) return this.err("invalid digit '" + c + "' in binary literal");
          return finish();
        }
        let nonzero = false;
        for (;;) {
          if (c === '_') {
            c = this.nextc();
            if (!isDigit(c)) { this.backup(); return invalidDecimal(); }
          }
          if (c !== '0') break;
          c = this.nextc();
        }
        if (isDigit(c)) { nonzero = true; if (!decimalTail()) return invalidDecimal(); }
        if (c === '.') { c = this.nextc(); state = 'fraction'; }
        else if (c === 'e' || c === 'E') state = 'exponent';
        else if (c === 'j' || c === 'J') state = 'imaginary';
        else if (nonzero) {
          this.backup();
          return this.err('leading zeros in decimal integer literals are not permitted; use an 0o prefix for octal integers');
        } else return finish();
      } else {
        if (!decimalTail()) return invalidDecimal();
        if (c === '.') { c = this.nextc(); state = 'fraction'; }
        else state = 'afterfraction';
      }
    }
    if (state === 'fraction') {
      if (isDigit(c)) { if (!decimalTail()) return invalidDecimal(); }
      state = 'afterfraction';
    }
    if (state === 'afterfraction' && (c === 'e' || c === 'E')) state = 'exponent';
    if (state === 'exponent') {
      c = this.nextc();
      if (c === '+' || c === '-') {
        c = this.nextc();
        if (!isDigit(c)) { this.backup(); return invalidDecimal(); }
      } else if (!isDigit(c)) {
        this.backup(); this.backup();
        return this.tok('NUMBER', this.src.slice(start, this.pos));
      }
      if (!decimalTail()) return invalidDecimal();
    }
    if (c === 'j' || c === 'J') { c = this.nextc(); }
    return finish();
  }

  string(quote, start, flags) {
    const line = this.line;
    let quoteSize = 1, endQuoteSize = 0;
    let c = this.nextc();
    if (c === quote) {
      c = this.nextc();
      if (c === quote) quoteSize = 3; else endQuoteSize = 1;
    }
    if (c !== quote) this.backup();
    while (endQuoteSize !== quoteSize) {
      c = this.nextc();
      if (c === null) return this.err(quoteSize === 3 ? 'EOF while scanning triple-quoted string literal' : 'EOL while scanning string literal');
      if (quoteSize === 1 && c === '\n') return this.err('EOL while scanning string literal');
      if (c === quote) endQuoteSize++;
      else { endQuoteSize = 0; if (c === '\\') this.nextc(); }
    }
    const t = this.tok('STRING', this.src.slice(start, this.pos), line);
    t.bytes = flags.bytes; t.fstring = flags.fstring;
    return t;
  }
}

/* _PyUnicode_ScanIdentifier + the error verify_identifier raises for the first bad character */
function verifyIdentifier(text) {
  let i = 0;
  for (const ch of text) {
    const ok = i === 0 ? (ch === '_' || ID_START.test(ch)) : ID_CONTINUE.test(ch);
    if (!ok) {
      const hex = ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0');
      return isPrintable(ch) ? "invalid character '" + ch + "' (U+" + hex + ")" : 'invalid non-printable character U+' + hex;
    }
    i++;
  }
  return null;
}

/* NUMBER token text -> a Constant node's value, as float() will see it */
function numberValue(text) {
  const t = text.replace(/_/g, '');
  if (/[jJ]$/.test(t)) return { kind: 'complex' };
  let v;
  if (/^0[xX]/.test(t)) v = Number(BigInt(t));
  else if (/^0[oO]/.test(t)) v = Number(BigInt('0o' + t.slice(2)));
  else if (/^0[bB]/.test(t)) v = Number(BigInt('0b' + t.slice(2)));
  else if (/^\d+$/.test(t)) v = Number(BigInt(t));
  else return { kind: 'num', value: Number(t) };
  return Number.isFinite(v) ? { kind: 'num', value: v } : { kind: 'num', value: v, overflow: true };
}

/* _PyPegen_get_expr_name, for "cannot use assignment expressions with ..." */
function exprName(e) {
  switch (e.type) {
    case 'Attribute': return 'attribute'; case 'Subscript': return 'subscript'; case 'Starred': return 'starred';
    case 'Name': return 'name'; case 'List': return 'list'; case 'Tuple': return 'tuple'; case 'Lambda': return 'lambda';
    case 'Call': return 'function call'; case 'BoolOp': case 'BinOp': case 'UnaryOp': return 'operator';
    case 'GeneratorExp': return 'generator expression'; case 'Yield': case 'YieldFrom': return 'yield expression';
    case 'Await': return 'await expression'; case 'ListComp': return 'list comprehension';
    case 'SetComp': return 'set comprehension'; case 'DictComp': return 'dict comprehension';
    case 'Dict': return 'dict display'; case 'Set': return 'set display'; case 'JoinedStr': return 'f-string expression';
    case 'Compare': return 'comparison'; case 'IfExp': return 'conditional expression'; case 'NamedExpr': return 'named expression';
    case 'Constant':
      if (e.kind === 'none') return 'None'; if (e.kind === 'ellipsis') return 'Ellipsis';
      if (e.kind === 'bool') return e.value ? 'True' : 'False';
      return 'literal';
    default: return e.type;
  }
}

const FAIL = { fail: true };
const CMP_OPS = { '==': 'Eq', '!=': 'NotEq', '<=': 'LtE', '<': 'Lt', '>=': 'GtE', '>': 'Gt' };
const TERM_OPS = { '*': 'Mult', '/': 'Div', '//': 'FloorDiv', '%': 'Mod', '@': 'MatMult' };
const SUM_OPS = { '+': 'Add', '-': 'Sub' };
const SHIFT_OPS = { '<<': 'LShift', '>>': 'RShift' };

/* ast.parse(src, mode="eval").body, or a PySyntaxError with Python's message */
export function parseExpression(src) {
  src = String(src);
  if (src.includes('\0')) throw new PyValueError('source code string cannot contain null bytes');
  src = src.replace(/\r\n?/g, '\n');
  const tz = new Tokenizer(src);
  const tokens = [];
  let pos = 0, fill = 0;

  function fetch(i) {
    while (tokens.length <= i) {
      const last = tokens[tokens.length - 1];
      if (last && (last.type === 'ENDMARKER' || last.type === 'ERROR')) break;
      tokens.push(tz.get());
    }
    const idx = Math.min(i, tokens.length - 1);
    const t = tokens[idx];
    if (idx + 1 > fill) fill = idx + 1;
    if (t.type === 'ERROR') throw new PySyntaxError(t.msg, t.line);
    return t;
  }
  const peek = (k = 0) => fetch(pos + k);
  const take = () => { const t = peek(); pos++; return t; };
  const isOp = (v, k = 0) => { const t = peek(k); return t.type === 'OP' && t.value === v; };
  const isKw = (v, k = 0) => { const t = peek(k); return t.type === 'KW' && t.value === v; };
  const expectOp = v => { if (!isOp(v)) throw FAIL; return take(); };
  const expectKw = v => { if (!isKw(v)) throw FAIL; return take(); };
  const error = (msg, line) => new PySyntaxError(msg, line === undefined ? tokens[fill - 1].line : line);
  function attempt(fn) {
    const save = pos;
    try { return fn(); } catch (e) { if (e !== FAIL) throw e; pos = save; return null; }
  }

  function parseEval() {
    const body = parseExpressions();
    while (peek().type === 'NEWLINE') take();
    if (peek().type !== 'ENDMARKER') throw FAIL;
    return { type: 'Expression', body };
  }
  function parseExpressions() {
    const first = parseExpression();
    if (!isOp(',')) return first;
    const elts = [first];
    while (isOp(',')) {
      take();
      const e = attempt(parseExpression);
      if (!e) break;
      elts.push(e);
    }
    return { type: 'Tuple', elts };
  }
  function parseExpression() {
    if (isKw('lambda')) return parseLambda();
    const body = parseDisjunction();
    if (isKw('if')) {
      take();
      const test = parseDisjunction();
      expectKw('else');
      return { type: 'IfExp', test, body, orelse: parseExpression() };
    }
    return body;
  }
  function parseLambda() {
    expectKw('lambda');
    const args = [];
    while (!isOp(':')) {
      if (isOp('/') || isOp('*') || isOp('**')) {
        const marker = take().value;
        if (marker === '**') { if (peek().type !== 'NAME') throw FAIL; args.push({ name: take().value, kw: true }); }
        else if (marker === '*' && peek().type === 'NAME') args.push({ name: take().value, star: true });
      } else if (peek().type === 'NAME') {
        const name = take().value;
        let def = null;
        if (isOp('=')) { take(); def = parseExpression(); }
        args.push({ name, def });
      } else throw FAIL;
      if (isOp(',')) take(); else break;
    }
    expectOp(':');
    return { type: 'Lambda', args, body: parseExpression() };
  }
  function parseDisjunction() {
    const first = parseConjunction();
    if (!isKw('or')) return first;
    const values = [first];
    while (isKw('or')) { take(); values.push(parseConjunction()); }
    return { type: 'BoolOp', op: 'Or', values };
  }
  function parseConjunction() {
    const first = parseInversion();
    if (!isKw('and')) return first;
    const values = [first];
    while (isKw('and')) { take(); values.push(parseInversion()); }
    return { type: 'BoolOp', op: 'And', values };
  }
  function parseInversion() {
    if (isKw('not')) { take(); return { type: 'UnaryOp', op: 'Not', operand: parseInversion() }; }
    return parseComparison();
  }
  function parseComparison() {
    const left = parseBitwiseOr();
    const ops = [], comparators = [];
    for (;;) {
      const t = peek();
      let op = null;
      if (t.type === 'OP' && CMP_OPS[t.value]) { take(); op = CMP_OPS[t.value]; }
      else if (isKw('not') && isKw('in', 1)) { take(); take(); op = 'NotIn'; }
      else if (isKw('in')) { take(); op = 'In'; }
      else if (isKw('is')) { take(); if (isKw('not')) { take(); op = 'IsNot'; } else op = 'Is'; }
      else break;
      ops.push(op); comparators.push(parseBitwiseOr());
    }
    return ops.length ? { type: 'Compare', left, ops, comparators } : left;
  }
  function binaryChain(next, table) {
    return () => {
      let left = next();
      for (;;) {
        const t = peek();
        if (t.type !== 'OP' || !table[t.value]) return left;
        take();
        left = { type: 'BinOp', left, op: table[t.value], right: next() };
      }
    };
  }
  const parseTerm = binaryChain(parseFactor, TERM_OPS);
  const parseSum = binaryChain(parseTerm, SUM_OPS);
  const parseShift = binaryChain(parseSum, SHIFT_OPS);
  const parseBitwiseAnd = binaryChain(parseShift, { '&': 'BitAnd' });
  const parseBitwiseXor = binaryChain(parseBitwiseAnd, { '^': 'BitXor' });
  const parseBitwiseOr = binaryChain(parseBitwiseXor, { '|': 'BitOr' });
  function parseFactor() {
    if (isOp('+')) { take(); return { type: 'UnaryOp', op: 'UAdd', operand: parseFactor() }; }
    if (isOp('-')) { take(); return { type: 'UnaryOp', op: 'USub', operand: parseFactor() }; }
    if (isOp('~')) { take(); return { type: 'UnaryOp', op: 'Invert', operand: parseFactor() }; }
    return parsePower();
  }
  function parsePower() {
    const base = parseAwaitPrimary();
    if (isOp('**')) { take(); return { type: 'BinOp', left: base, op: 'Pow', right: parseFactor() }; }
    return base;
  }
  function parseAwaitPrimary() {
    if (isKw('await')) { take(); return { type: 'Await', value: parsePrimary() }; }
    return parsePrimary();
  }
  function parsePrimary() {
    let node = parseAtom();
    for (;;) {
      if (isOp('.')) {
        take();
        if (peek().type !== 'NAME') throw FAIL;
        node = { type: 'Attribute', value: node, attr: take().value };
      } else if (isOp('(')) {
        take();
        node = parseCall(node);
      } else if (isOp('[')) {
        take();
        const slice = parseSlices();
        expectOp(']');
        node = { type: 'Subscript', value: node, slice };
      } else return node;
    }
  }
  function parseSlices() {
    const first = parseSlice();
    if (!isOp(',')) return first;
    const elts = [first];
    while (isOp(',')) {
      take();
      const s = attempt(parseSlice);
      if (!s) break;
      elts.push(s);
    }
    return { type: 'Tuple', elts };
  }
  function parseSlice() {
    let lower = null, upper = null, step = null;
    if (!isOp(':')) {
      lower = parseExpression();
      if (!isOp(':')) return lower;
    }
    take();
    if (!isOp(':') && !isOp(',') && !isOp(']')) upper = parseExpression();
    if (isOp(':')) { take(); if (!isOp(',') && !isOp(']')) step = parseExpression(); }
    return { type: 'Slice', lower, upper, step };
  }
  /* '(' already taken: arguments then ')', or a bare generator expression */
  function parseCall(func) {
    const args = [], keywords = [];
    let seenKw = false, seenDoubleStar = false;
    if (isOp(')')) { take(); return { type: 'Call', func, args, keywords }; }
    for (;;) {
      if (isOp('*')) {
        take();
        if (seenDoubleStar) throw error('iterable argument unpacking follows keyword argument unpacking');
        args.push({ type: 'Starred', value: parseExpression() });
      } else if (isOp('**')) {
        take();
        keywords.push({ arg: null, value: parseExpression() });
        seenDoubleStar = true;
      } else if (peek().type === 'NAME' && isOp('=', 1)) {
        const arg = take().value; take();
        keywords.push({ arg, value: parseExpression() });
        seenKw = true;
      } else {
        let value;
        if (peek().type === 'NAME' && isOp(':=', 1)) {
          const target = take().value; take();
          value = { type: 'NamedExpr', target: { type: 'Name', id: target }, value: parseExpression() };
        } else {
          value = parseExpression();
          if (isOp(':=')) throw error('cannot use assignment expressions with ' + exprName(value));
          if (isOp('=')) throw error('expression cannot contain assignment, perhaps you meant "=="?');
        }
        if (isKw('for') || isKw('async')) {
          const gen = { type: 'GeneratorExp', elt: value, generators: parseForIfClauses() };
          if (args.length || keywords.length || !isOp(')')) throw error('Generator expression must be parenthesized');
          take();
          return { type: 'Call', func, args: [gen], keywords };
        }
        if (seenDoubleStar) throw error('positional argument follows keyword argument unpacking');
        if (seenKw) throw error('positional argument follows keyword argument');
        args.push(value);
      }
      if (isOp(',')) { take(); if (isOp(')')) break; continue; }
      break;
    }
    expectOp(')');
    return { type: 'Call', func, args, keywords };
  }
  function parseForIfClauses() {
    const generators = [];
    while (isKw('for') || isKw('async')) {
      let isAsync = false;
      if (isKw('async')) { take(); isAsync = true; }
      expectKw('for');
      const target = parseStarTargets();
      expectKw('in');
      const iter = parseDisjunction();
      const ifs = [];
      while (isKw('if')) { take(); ifs.push(parseDisjunction()); }
      generators.push({ target, iter, ifs, is_async: isAsync });
    }
    return generators;
  }
  function parseStarTargets() {
    const one = () => (isOp('*') ? (take(), { type: 'Starred', value: one() }) : parseBitwiseOr());
    const first = one();
    if (!isOp(',')) return first;
    const elts = [first];
    while (isOp(',')) {
      take();
      if (isKw('in')) break;
      elts.push(one());
    }
    return { type: 'Tuple', elts };
  }
  function parseNamedExpression() {
    if (peek().type === 'NAME' && isOp(':=', 1)) {
      const target = take().value; take();
      return { type: 'NamedExpr', target: { type: 'Name', id: target }, value: parseExpression() };
    }
    const e = parseExpression();
    if (isOp(':=')) throw error('cannot use assignment expressions with ' + exprName(e));
    return e;
  }
  function parseStarNamedExpression() {
    if (isOp('*')) { take(); return { type: 'Starred', value: parseBitwiseOr() }; }
    return parseNamedExpression();
  }
  function parseStarExpression() {
    if (isOp('*')) { take(); return { type: 'Starred', value: parseBitwiseOr() }; }
    return parseExpression();
  }
  function parseYield() {
    expectKw('yield');
    if (isKw('from')) { take(); return { type: 'YieldFrom', value: parseExpression() }; }
    if (isOp(')')) return { type: 'Yield', value: null };
    const first = parseStarExpression();
    if (!isOp(',')) return { type: 'Yield', value: first };
    const elts = [first];
    while (isOp(',')) {
      take();
      const e = attempt(parseStarExpression);
      if (!e) break;
      elts.push(e);
    }
    return { type: 'Yield', value: { type: 'Tuple', elts } };
  }
  function parseStrings() {
    let bytes = false, nonbytes = false, fstring = false;
    while (peek().type === 'STRING') {
      const t = take();
      if (t.bytes) bytes = true; else nonbytes = true;
      if (t.fstring) fstring = true;
    }
    if (bytes && nonbytes) throw error('cannot mix bytes and nonbytes literals');
    if (fstring) return { type: 'JoinedStr' };
    return { type: 'Constant', kind: bytes ? 'bytes' : 'str' };
  }
  function parseAtom() {
    const t = peek();
    if (t.type === 'NAME') { take(); return { type: 'Name', id: t.value }; }
    if (t.type === 'KW') {
      if (t.value === 'True' || t.value === 'False') { take(); return { type: 'Constant', kind: 'bool', value: t.value === 'True' ? 1 : 0 }; }
      if (t.value === 'None') { take(); return { type: 'Constant', kind: 'none' }; }
      throw FAIL;
    }
    if (t.type === 'NUMBER') { take(); return Object.assign({ type: 'Constant' }, numberValue(t.value)); }
    if (t.type === 'STRING') return parseStrings();
    if (t.type !== 'OP') throw FAIL;
    if (t.value === '...') { take(); return { type: 'Constant', kind: 'ellipsis' }; }
    if (t.value === '(') {
      take();
      if (isOp(')')) { take(); return { type: 'Tuple', elts: [] }; }
      if (isKw('yield')) { const y = parseYield(); expectOp(')'); return y; }
      const first = parseStarNamedExpression();
      if (isOp(',')) {
        const elts = [first];
        while (isOp(',')) { take(); if (isOp(')')) break; elts.push(parseStarNamedExpression()); }
        expectOp(')');
        return { type: 'Tuple', elts };
      }
      if (isKw('for') || isKw('async')) {
        if (first.type === 'Starred') throw error('iterable unpacking cannot be used in comprehension');
        const generators = parseForIfClauses();
        expectOp(')');
        return { type: 'GeneratorExp', elt: first, generators };
      }
      expectOp(')');
      if (first.type === 'Starred') throw error("can't use starred expression here");
      return first;
    }
    if (t.value === '[') {
      take();
      if (isOp(']')) { take(); return { type: 'List', elts: [] }; }
      const first = parseStarNamedExpression();
      if (isKw('for') || isKw('async')) {
        if (first.type === 'Starred') throw error('iterable unpacking cannot be used in comprehension');
        const generators = parseForIfClauses();
        expectOp(']');
        return { type: 'ListComp', elt: first, generators };
      }
      const elts = [first];
      while (isOp(',')) { take(); if (isOp(']')) break; elts.push(parseStarNamedExpression()); }
      expectOp(']');
      return { type: 'List', elts };
    }
    if (t.value === '{') {
      take();
      if (isOp('}')) { take(); return { type: 'Dict', keys: [], values: [] }; }
      const keys = [], values = [];
      const pair = () => {
        if (isOp('**')) { take(); keys.push(null); values.push(parseBitwiseOr()); return true; }
        const k = parseExpression();
        if (!isOp(':')) return k;
        take();
        keys.push(k); values.push(parseExpression());
        return true;
      };
      const first = isOp('*') ? parseStarNamedExpression() : pair();
      if (first === true) {
        if (isKw('for') || isKw('async')) {
          if (keys[0] === null) throw error('dict unpacking cannot be used in dict comprehension');
          const generators = parseForIfClauses();
          expectOp('}');
          return { type: 'DictComp', key: keys[0], value: values[0], generators };
        }
        while (isOp(',')) { take(); if (isOp('}')) break; if (pair() !== true) throw FAIL; }
        expectOp('}');
        return { type: 'Dict', keys, values };
      }
      if (isKw('for') || isKw('async')) {
        if (first.type === 'Starred') throw error('iterable unpacking cannot be used in comprehension');
        const generators = parseForIfClauses();
        expectOp('}');
        return { type: 'SetComp', elt: first, generators };
      }
      const elts = [first];
      while (isOp(',')) { take(); if (isOp('}')) break; elts.push(parseStarNamedExpression()); }
      expectOp('}');
      return { type: 'Set', elts };
    }
    throw FAIL;
  }

  try {
    return parseEval();
  } catch (e) {
    if (e !== FAIL) throw e;
    const last = tokens[fill - 1];
    if (last.eof) throw new PySyntaxError('unexpected EOF while parsing', last.line);
    if (last.type === 'INDENT') throw new PySyntaxError('unexpected indent', last.line);
    throw new PySyntaxError('invalid syntax', last.line);
  }
}
