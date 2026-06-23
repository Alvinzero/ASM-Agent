import { describe, expect, it } from 'vitest';
import { parseAsm } from '../../src/shared/asm/AsmParser';

describe('AsmParser', () => {
  it('parses labels, instructions, operands, and comments', () => {
    const program = parseAsm(
      ['; reset entry', 'reset_entry:', '  CLRWDT', '  JMP main_loop ; continue forever', 'main_loop:'].join('\n')
    );

    expect(program.lines).toMatchObject([
      { kind: 'comment', comment: 'reset entry' },
      { kind: 'label', label: 'reset_entry', comment: '' },
      { kind: 'instruction', mnemonic: 'CLRWDT', operands: [], comment: '' },
      { kind: 'instruction', mnemonic: 'JMP', operands: ['main_loop'], comment: 'continue forever' },
      { kind: 'label', label: 'main_loop', comment: '' }
    ]);
  });

  it('preserves inline comments on instruction lines', () => {
    const program = parseAsm('  MOV A, B ; copy B into A');

    expect(program.lines[0]).toMatchObject({
      kind: 'instruction',
      mnemonic: 'MOV',
      operands: ['A', 'B'],
      comment: 'copy B into A'
    });
  });

  it('preserves inline comments on label lines', () => {
    const program = parseAsm('main_loop: ; loop entry');

    expect(program.lines[0]).toMatchObject({
      kind: 'label',
      label: 'main_loop',
      comment: 'loop entry'
    });
  });

  it('keeps source line numbers for diagnostics', () => {
    const program = parseAsm('CLRWDT\nBADOP A');

    expect(program.lines[1].lineNumber).toBe(2);
    expect(program.lines[1].source).toBe('BADOP A');
  });

  it('represents blank lines explicitly', () => {
    const program = parseAsm('CLRWDT\n   \nJMP main_loop');

    expect(program.lines[1]).toMatchObject({
      kind: 'blank',
      lineNumber: 2,
      source: '   '
    });
  });

  it('splits and trims comma-separated operands', () => {
    const program = parseAsm('  BTSZ R0,  3');

    expect(program.lines[0]).toMatchObject({
      kind: 'instruction',
      mnemonic: 'BTSZ',
      operands: ['R0', '3']
    });
  });

  it('keeps malformed comma operands permissively', () => {
    const program = parseAsm('MOV A,');

    expect(program.lines[0]).toMatchObject({
      kind: 'instruction',
      mnemonic: 'MOV',
      operands: ['A', '']
    });
  });

  it('accepts labels beginning with letters or underscores', () => {
    expect(parseAsm('_label:').lines[0]).toMatchObject({
      kind: 'label',
      label: '_label'
    });
    expect(parseAsm('A1:').lines[0]).toMatchObject({
      kind: 'label',
      label: 'A1'
    });
  });

  it('does not parse invalid label forms as labels', () => {
    expect(parseAsm('1bad:').lines[0]).not.toMatchObject({ kind: 'label' });
    expect(parseAsm('bad-name:').lines[0]).not.toMatchObject({ kind: 'label' });
    expect(parseAsm('label :').lines[0]).not.toMatchObject({ kind: 'label' });
  });

  it('preserves the final blank line from a trailing newline', () => {
    const program = parseAsm('CLRWDT\n');

    expect(program.lines).toHaveLength(2);
    expect(program.lines[1]).toMatchObject({
      kind: 'blank',
      lineNumber: 2,
      source: ''
    });
  });

  it('normalizes instruction mnemonics to uppercase', () => {
    const program = parseAsm('  clrwdt');

    expect(program.lines[0]).toMatchObject({
      kind: 'instruction',
      mnemonic: 'CLRWDT'
    });
  });
});
