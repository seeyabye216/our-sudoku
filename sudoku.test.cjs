const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const generatorScript = readFileSync(require.resolve('./sudoku-generator.js'), 'utf8');
const script = readFileSync(require.resolve('./index.html'), 'utf8').split('<script>')[1].split('</script>')[0];
const saveKey = 'our-sudoku-v1';
const historyKey = 'our-sudoku-played-v1';

function element() {
  return {
    children: [],
    dataset: {},
    classList: { add() {}, toggle() {} },
    append(child) { this.children.push(child); },
    set innerHTML(value) { this.children = []; },
    setAttribute() {},
    focus() {},
    show() { this.open = true; },
    close() { this.open = false; },
  };
}

function openGame(saved, storage = new Map()) {
  const nodes = new Map();
  if (saved) storage.set(saveKey, JSON.stringify(saved));
  const document = {
    createElement: element,
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    },
  };
  const context = vm.createContext({
    document,
    confirm: () => true,
    setTimeout,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  });
  const run = code => vm.runInContext(code, context);
  run(generatorScript);
  run(script);
  const node = id => nodes.get(id);
  return {
    run,
    node,
    click: id => node(id).onclick(),
    cell: index => node('board').children[index].onclick(),
    digit: digit => node('big').children[digit - 1].onclick(),
    state: () => JSON.parse(storage.get(saveKey)),
  };
}

// Independent search for the catalog test, using unit sets and row-major traversal.
function enumerate(clues) {
  const grid = Array.from(clues, Number);
  const rows = Array.from({ length: 9 }, () => new Set());
  const columns = Array.from({ length: 9 }, () => new Set());
  const boxes = Array.from({ length: 9 }, () => new Set());
  const unitsAt = index => {
    const row = Math.floor(index / 9);
    const column = index % 9;
    return [rows[row], columns[column], boxes[Math.floor(row / 3) * 3 + Math.floor(column / 3)]];
  };
  for (const [index, digit] of grid.entries()) {
    if (!digit) continue;
    const units = unitsAt(index);
    if (units.some(unit => unit.has(digit))) return [];
    units.forEach(unit => unit.add(digit));
  }

  const answers = [];
  function search(from) {
    const index = grid.indexOf(0, from);
    if (index === -1) {
      answers.push(grid.join(''));
      return;
    }
    const units = unitsAt(index);
    for (let digit = 1; digit <= 9 && answers.length < 2; digit++) {
      if (units.some(unit => unit.has(digit))) continue;
      grid[index] = digit;
      units.forEach(unit => unit.add(digit));
      search(index + 1);
      units.forEach(unit => unit.delete(digit));
    }
    grid[index] = 0;
  }
  search(0);
  return answers;
}

function fixture(level, record, entries) {
  return {
    difficulty: level,
    puzzle: record[0],
    solution: '0'.repeat(81),
    entries,
    notes: Array.from({ length: 81 }, () => []),
  };
}

const difficultAlternate = '358472916642195387197386542589761423426853791713924658961538274274619835835247169';

test('all five selectable puzzles have exactly one solution and valid stored answers', () => {
  const game = openGame();
  assert.equal(game.run('pool.easy.length'), 2);
  assert.equal(game.run('pool.moderate.length'), 2);
  assert.equal(game.run('pool.difficult.length'), 1);
  assert.equal(game.run('JSON.stringify(pool.easy.map(([clues]) => clues))'), JSON.stringify([
    '530070000600195000098000060800060003400803001700020006060000280000419005000080079',
    '000260701680070090190004500820100040004602900050003028009300074040050036703018000',
  ]));
  for (const [clues, answer] of game.run('Object.values(puzzles).flat()')) {
    assert.deepEqual(enumerate(clues), [answer]);
    assert.equal(game.run(`isSolved('${clues}', Array.from('${answer}', Number))`), true);
  }
});

test('an incorrect full grid does not complete; correcting the final entry does', () => {
  const record = openGame().run('pool.difficult[0]');
  const entries = Array.from(record[1], Number);
  const index = record[0].indexOf('0');
  const correct = entries[index];
  entries[index] = correct === 1 ? 2 : 1;
  const game = openGame(fixture('difficult', record, entries));
  assert.ok(!game.node('solved-dialog').open);
  game.cell(index);
  game.digit(correct);
  assert.ok(game.node('solved-dialog').open);
  game.click('solved-ok');
  const reopened = openGame(game.state());
  assert.ok(!reopened.node('solved-dialog').open);
  reopened.click('erase');
  assert.ok(!reopened.node('solved-dialog').open);
  reopened.click('undo');
  assert.ok(reopened.node('solved-dialog').open);
});

test('Check distinguishes direct conflicts, dead ends, and extendible entries', () => {
  const record = openGame().run('pool.moderate[0]');
  const game = openGame(fixture('moderate', record, Array.from(record[0], Number)));
  const clues = Array.from(record[0], Number);
  const index = clues.findIndex((digit, cell) => !digit &&
    game.run(`puzzle[${cell}] === '0' && candidates(${cell}).some(digit => digit !== Number(solution[${cell}]))`));
  assert.ok(index >= 0);
  const wrong = game.run(`candidates(${index}).find(digit => digit !== Number(solution[${index}]))`);
  const conflicting = Number(record[0].slice(Math.floor(index / 9) * 9, Math.floor(index / 9) * 9 + 9).match(/[1-9]/)[0]);
  game.click('check');
  assert.match(game.node('status').textContent, /can be completed/);
  game.cell(index);
  game.digit(wrong);
  game.click('check');
  assert.match(game.node('status').textContent, /no valid completion/);
  game.digit(wrong);
  game.cell(index);
  game.digit(conflicting);
  game.click('check');
  assert.match(game.node('status').textContent, /conflicting numbers/);
});

test('legacy alternate entries can pass Check and complete through the normal input flow', async () => {
  const record = openGame().run('legacyPuzzles.difficult[0]');
  const entries = Array.from(difficultAlternate, Number);
  const index = record[0].indexOf('0');
  const last = entries[index];
  assert.notEqual(difficultAlternate, record[1]);
  entries[index] = 0;
  const saved = fixture('difficult', record, entries);
  saved.notes[index] = [last];
  const game = openGame(saved);
  assert.deepEqual(game.state(), { ...saved, solution: record[1] });
  assert.ok(!game.node('solved-dialog').open);
  game.click('check');
  assert.match(game.node('status').textContent, /can be completed/);
  game.cell(index);
  game.digit(last);
  assert.ok(game.node('solved-dialog').open);
  game.click('check');
  assert.match(game.node('status').textContent, /valid solution/);
  game.click('reset');
  assert.deepEqual(game.state().entries, Array.from(record[0], Number));
  assert.ok(!game.node('solved-dialog').open);
  await game.click('new');
  assert.notEqual(game.state().puzzle, record[0]);
});

test('restore uses catalog answers and preserves valid progress for every retired puzzle', () => {
  const catalog = openGame();
  for (const level of ['moderate', 'difficult']) {
    for (const record of catalog.run(`legacyPuzzles.${level}`)) {
      assert.equal(enumerate(record[0]).length, 2);
      assert.equal(catalog.run(`isSolved('${record[0]}', Array.from('${record[1]}', Number))`), true);
      const entries = Array.from(record[0], Number);
      const empties = entries.flatMap((digit, index) => digit ? [] : [index]);
      entries[empties[0]] = Number(record[1][empties[0]]);
      const saved = fixture(level, record, entries);
      saved.notes[empties[1]] = [2, 4];
      delete saved.solution;
      const restored = openGame(saved);
      assert.deepEqual(restored.state(), { ...saved, solution: record[1] });
    }
  }
  const record = catalog.run('pool.easy[0]');
  const entries = Array.from(record[1], Number);
  const clue = Array.from(record[0], Number).findIndex(Boolean);
  const corrupted = entries.slice();
  corrupted[clue] = 0;
  const game = openGame(fixture('easy', record, corrupted));
  assert.deepEqual(game.state().entries, entries);
  assert.equal(game.state().solution, record[1]);
  assert.ok(game.node('solved-dialog').open);
});

function seededRandom(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

test('100 generated puzzles per level are unique, varied, and logically solvable', t => {
  const generator = vm.runInNewContext(generatorScript + '\nSudokuGenerator');
  const catalog = openGame().run('[...Object.values(puzzles).flat(), ...Object.values(legacyPuzzles).flat()]');
  const seen = new Set(catalog.map(([clues]) => clues));
  const patterns = new Set();
  const answers = new Set();
  const random = seededRandom(82736);
  for (const level of ['easy', 'moderate', 'difficult']) {
    const elapsed = [];
    for (let index = 0; index < 100; index++) {
      const start = performance.now();
      const record = generator.generate(level, seen, { random });
      elapsed.push(performance.now() - start);
      assert.ok(record, `Could not generate ${level} puzzle ${index + 1}`);
      const [clues, answer] = record;
      assert.match(clues, /^[0-9]{81}$/);
      assert.match(answer, /^[1-9]{81}$/);
      assert.ok(!seen.has(clues));
      seen.add(clues);
      const pattern = clues.replace(/[1-9]/g, '1');
      assert.ok(!patterns.has(pattern));
      patterns.add(pattern);
      assert.ok(!answers.has(answer));
      answers.add(answer);
      assert.deepEqual(enumerate(clues), [answer]);
      const logic = generator.logicalSolve(clues);
      assert.equal(logic.solved, true);
      assert.equal(logic.answer, answer);
      assert.equal(logic.level, level);
      const techniques = new Set(logic.steps.map(step => step.technique));
      if (level === 'easy') assert.deepEqual([...techniques], ['naked single']);
      if (level === 'moderate') assert.ok(techniques.has('hidden single'));
      if (level === 'difficult') assert.ok(techniques.has('locked candidates') || techniques.has('naked pair'));
    }
    elapsed.sort((a, b) => a - b);
    t.diagnostic(`${level}: median ${elapsed[49].toFixed(1)} ms, p95 ${elapsed[94].toFixed(1)} ms, max ${elapsed[99].toFixed(1)} ms`);
  }
  // Given the same random choices, an already-played result is skipped.
  const first = generator.generate('easy', new Set(), { random: seededRandom(1) });
  const next = generator.generate('easy', new Set([first[0]]), { random: seededRandom(1) });
  assert.notEqual(next[0], first[0]);
});

test('generated progress and played-puzzle history survive closing and reopening', async () => {
  const storage = new Map();
  const game = openGame(undefined, storage);
  const first = game.state();
  assert.equal(first.generated, true);
  const mutable = Array.from(first.puzzle).flatMap((digit, index) => digit === '0' ? [index] : []);
  game.cell(mutable[0]);
  game.digit(Number(first.solution[mutable[0]]));
  game.node('small').children[2].onclick();
  game.cell(mutable[1]);
  const progress = game.state();
  assert.deepEqual(progress.notes[mutable[1]], [3]);
  const reopened = openGame({ ...progress, solution: '0'.repeat(81) }, storage);
  assert.deepEqual(reopened.state(), progress);
  assert.ok(JSON.parse(storage.get(historyKey)).includes(first.puzzle));
  await reopened.click('new');
  const second = reopened.state();
  assert.notEqual(second.puzzle, first.puzzle);
  assert.ok(JSON.parse(storage.get(historyKey)).includes(first.puzzle));
  assert.ok(JSON.parse(storage.get(historyKey)).includes(second.puzzle));
  reopened.click('reset');
  assert.equal(reopened.state().puzzle, second.puzzle);
  assert.equal(reopened.state().generated, true);
});

test('bounded failure keeps the current game and reports that generation failed', async () => {
  const game = openGame();
  const before = game.state();
  game.run('let attempts = 0; SudokuGenerator.generate = () => { attempts++; return null; };');
  game.node('difficulty').value = 'difficult';
  await game.node('difficulty').onchange();
  assert.equal(game.run('attempts'), game.run('SudokuGenerator.maxAttempts'));
  assert.deepEqual(game.state(), before);
  assert.equal(game.node('difficulty').value, before.difficulty);
  assert.match(game.node('status').textContent, /current puzzle was kept/);
});
