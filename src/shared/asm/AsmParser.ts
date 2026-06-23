export type AsmBlankLine = {
  kind: 'blank';
  source: string;
  lineNumber: number;
};

export type AsmCommentLine = {
  kind: 'comment';
  source: string;
  lineNumber: number;
  comment: string;
};

export type AsmLabelLine = {
  kind: 'label';
  source: string;
  lineNumber: number;
  label: string;
  comment: string;
};

export type AsmInstructionLine = {
  kind: 'instruction';
  source: string;
  lineNumber: number;
  mnemonic: string;
  operands: string[];
  comment: string;
};

export type AsmLine = AsmBlankLine | AsmCommentLine | AsmLabelLine | AsmInstructionLine;

export type AsmProgram = {
  lines: AsmLine[];
};

const LABEL_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*:$/;

export function parseAsm(source: string): AsmProgram {
  return {
    lines: source.split(/\r?\n/).map((line, index) => parseLine(line, index + 1))
  };
}

function parseLine(source: string, lineNumber: number): AsmLine {
  const commentStart = source.indexOf(';');
  const code = commentStart === -1 ? source : source.slice(0, commentStart);
  const comment = commentStart === -1 ? '' : source.slice(commentStart + 1).trim();
  const trimmedCode = code.trim();

  if (trimmedCode.length === 0) {
    if (commentStart !== -1) {
      return {
        kind: 'comment',
        source,
        lineNumber,
        comment
      };
    }

    return {
      kind: 'blank',
      source,
      lineNumber
    };
  }

  if (LABEL_PATTERN.test(trimmedCode)) {
    return {
      kind: 'label',
      source,
      lineNumber,
      label: trimmedCode.slice(0, -1),
      comment
    };
  }

  const firstWhitespace = trimmedCode.search(/\s/);
  const mnemonic = firstWhitespace === -1 ? trimmedCode : trimmedCode.slice(0, firstWhitespace);
  const operandText = firstWhitespace === -1 ? '' : trimmedCode.slice(firstWhitespace).trim();

  return {
    kind: 'instruction',
    source,
    lineNumber,
    mnemonic: mnemonic.toUpperCase(),
    operands: operandText.length === 0 ? [] : operandText.split(',').map((operand) => operand.trim()),
    comment
  };
}
