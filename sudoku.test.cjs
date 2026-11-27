const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

const script = readFileSync(require.resolve('./index.html'), 'utf8').split('<script>')[1].split('</script>')[0];
const saveKey = 'our-sudoku-v1';

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

function openGame(saved) {
  const nodes = new Map();
  const storage = new Map(saved ? [[saveKey, JSON.stringify(saved)]] : []);
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
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  });
  const run = code => vm.runInContext(code, context);
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
  const game = openGame();
  const record = game.run('pool.moderate[0]');
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

test('legacy alternate entries can pass Check and complete through the normal input flow', () => {
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
  game.click('new');
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
