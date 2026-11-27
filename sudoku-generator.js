'use strict';

const SudokuGenerator = (() => {
  const size = 9;
  const cellCount = 81;
  const allDigits = 0x3fe;
  const cells = Array.from({length: cellCount}, (_, index) => index);
  const digits = Array.from({length: size}, (_, index) => index + 1);
  const cellUnits = cells.map(index => {
    const row = Math.floor(index / size);
    const column = index % size;
    const box = Math.floor(row / 3) * 3 + Math.floor(column / 3);
    return [row, 9 + column, 18 + box];
  });
  const units = Array.from({length: 27}, (_, unit) => cells.filter(index => cellUnits[index].includes(unit)));
  const peers = cells.map(index =>
    [...new Set(cellUnits[index].flatMap(unit => units[unit]))].filter(other => other !== index));
  const bitCount = Array.from({length: allDigits + 1}, (_, mask) => {
    let count = 0;
    for (let bits = mask; bits; bits &= bits - 1) count++;
    return count;
  });

  function shuffle(values, random) {
    for (let index = values.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [values[index], values[other]] = [values[other], values[index]];
    }
    return values;
  }

  // An exhausted search never establishes uniqueness, even if it found one answer.
  function search(grid, limit = 1, {random, nodeLimit = Infinity} = {}) {
    const working = [...grid];
    const used = Array(27).fill(0);
    let count = 0;
    let answer;
    let visited = 0;
    let exhausted = false;
    if (working.length !== cellCount) return {count, answer, exhausted};
    for (const index of cells) {
      const digit = working[index];
      if (!Number.isInteger(digit) || digit < 0 || digit > 9) return {count, answer, exhausted};
      if (!digit) continue;
      const bit = 1 << digit;
      if (cellUnits[index].some(unit => used[unit] & bit)) return {count, answer, exhausted};
      for (const unit of cellUnits[index]) used[unit] |= bit;
    }

    function visit() {
      if (++visited > nodeLimit) {
        exhausted = true;
        return;
      }
      let target = -1;
      let options = 0;
      let fewest = 10;
      for (const index of cells) {
        if (working[index]) continue;
        const [row, column, box] = cellUnits[index];
        const mask = allDigits & ~(used[row] | used[column] | used[box]);
        if (!mask) return;
        if (bitCount[mask] < fewest) {
          target = index;
          options = mask;
          fewest = bitCount[mask];
          if (fewest === 1) break;
        }
      }
      if (target === -1) {
        count++;
        answer ??= working.join('');
        return;
      }
      const candidates = digits.filter(digit => options & (1 << digit));
      if (random) shuffle(candidates, random);
      for (const digit of candidates) {
        const bit = 1 << digit;
        working[target] = digit;
        for (const unit of cellUnits[target]) used[unit] |= bit;
        visit();
        for (const unit of cellUnits[target]) used[unit] &= ~bit;
        working[target] = 0;
        if (count >= limit || exhausted) return;
      }
    }

    visit();
    return {count, answer, exhausted};
  }

  function nakedSingle(candidates) {
    const cell = candidates.findIndex(mask => bitCount[mask] === 1);
    if (cell >= 0) return {cell, digit: Math.log2(candidates[cell])};
  }

  function hiddenSingle(candidates) {
    for (const [unit, indices] of units.entries()) {
      for (const digit of digits) {
        const places = indices.filter(index => candidates[index] & (1 << digit));
        if (places.length === 1) return {cell: places[0], digit, unit};
      }
    }
  }

  function lockedCandidates(candidates) {
    for (const [unit, indices] of units.entries()) {
      for (const digit of digits) {
        const mask = 1 << digit;
        const source = indices.filter(index => candidates[index] & mask);
        if (source.length < 2) continue;
        for (const target of cellUnits[source[0]]) {
          if (target === unit || !source.every(index => cellUnits[index].includes(target))) continue;
          const cells = units[target].filter(index => !cellUnits[index].includes(unit) && candidates[index] & mask);
          if (cells.length) return {cells, mask, source, unit, target};
        }
      }
    }
  }

  function nakedPair(candidates) {
    for (const [unit, indices] of units.entries()) {
      for (const index of indices) {
        const mask = candidates[index];
        if (bitCount[mask] !== 2) continue;
        const source = indices.filter(other => candidates[other] === mask);
        if (source.length !== 2) continue;
        const cells = indices.filter(other => !source.includes(other) && candidates[other] & mask);
        if (cells.length) return {cells, mask, source, unit};
      }
    }
  }

  const techniques = [
    {name: 'naked single', level: 'easy', find: nakedSingle},
    {name: 'hidden single', level: 'moderate', find: hiddenSingle},
    {name: 'locked candidates', level: 'difficult', find: lockedCandidates},
    {name: 'naked pair', level: 'difficult', find: nakedPair},
  ];
  const levels = ['easy', 'moderate', 'difficult'];

  // Steps carry cell and unit information for future teaching hints.
  function logicalSolve(clues) {
    const grid = Array.from(clues, Number);
    if (grid.length !== cellCount || grid.some((digit, index) =>
      !Number.isInteger(digit) || digit < 0 || digit > 9 ||
      (digit && peers[index].some(peer => grid[peer] === digit)))) return {solved: false, steps: []};
    const candidates = grid.map((digit, index) => {
      if (digit) return 0;
      let mask = allDigits;
      for (const peer of peers[index]) mask &= ~(1 << grid[peer]);
      return mask;
    });
    let level = 'easy';
    const steps = [];
    while (grid.includes(0)) {
      let step;
      for (const technique of techniques) {
        const action = technique.find(candidates);
        if (action) {
          step = {...action, technique: technique.name, level: technique.level};
          break;
        }
      }
      if (!step) return {solved: false, steps};
      steps.push(step);
      if (levels.indexOf(step.level) > levels.indexOf(level)) level = step.level;
      if ('digit' in step) {
        grid[step.cell] = step.digit;
        candidates[step.cell] = 0;
        for (const peer of peers[step.cell]) candidates[peer] &= ~(1 << step.digit);
      } else {
        for (const index of step.cells) candidates[index] &= ~step.mask;
      }
    }
    return {solved: true, answer: grid.join(''), level, steps};
  }

  // Clue ranges narrow the search. Acceptance depends on the strongest logical technique.
  const clueRanges = {easy: [33, 40], moderate: [26, 35], difficult: [23, 32]};
  const maxAttempts = 18;

  function generate(level, seen, {random = Math.random, attempts = maxAttempts} = {}) {
    if (!Object.hasOwn(clueRanges, level)) return null;
    const [minClues, maxClues] = clueRanges[level];
    const nodeLimit = 12000;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const {answer} = search(Array(cellCount).fill(0), 1, {random, nodeLimit});
      if (!answer) continue;
      const grid = Array.from(answer, Number);
      let clueCount = cellCount;
      for (const index of shuffle([...cells], random)) {
        const digit = grid[index];
        grid[index] = 0;
        const result = search(grid, 2, {nodeLimit});
        if (result.exhausted || result.count !== 1) {
          grid[index] = digit;
          continue;
        }
        if (--clueCount > maxClues) continue;
        const clues = grid.join('');
        if (!seen.has(clues)) {
          const rating = logicalSolve(clues);
          if (rating.solved && rating.level === level && rating.answer === answer) return [clues, answer];
        }
        if (clueCount === minClues) break;
      }
    }
    return null;
  }

  return {search, logicalSolve, generate, maxAttempts};
})();
