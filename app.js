(function () {
  'use strict';

  const CUTOFF = '2026-08-17';
  const PREVIEW_LIMIT = 50;
  const CSV_CAP = 2000;
  const COLUMNS = ['customer_id', 'city', 'channel', 'signup_month', 'order_count', 'last_order_date'];
  const STATUSES = ['All', 'Active', 'Lapsed', 'No delivered order'];

  // The single approved template. Only the :named parameters vary; the cutoff is a constant.
  const WHERE = `
WHERE (:city = 'All' OR city = :city)
  AND (:channel = 'All' OR channel = :channel)
  AND (:month = 'All' OR signup_month = :month)
  AND (:status = 'All' OR status = :status)`;
  const FROM = `
FROM (
  SELECT *,
    CASE
      WHEN order_count = 0 THEN 'No delivered order'
      WHEN order_count >= 1 AND last_order_date >= '${CUTOFF}' THEN 'Active'
      WHEN order_count >= 1 AND last_order_date < '${CUTOFF}' THEN 'Lapsed'
    END AS status
  FROM customers
) AS c`;
  const SQL_COUNT = `SELECT COUNT(*)${FROM}${WHERE}`;
  const SQL_ROWS = `SELECT ${COLUMNS.join(', ')}${FROM}${WHERE}
ORDER BY customer_id
LIMIT :lim`;

  const $ = (id) => document.getElementById(id);
  let db = null;

  function parseCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.length);
    const header = lines.shift().split(',');
    return { header, rows: lines.map((l) => l.split(',')) };
  }

  function csvEscape(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function run(sql, params) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) rows.push(stmt.get());
    stmt.free();
    return rows;
  }

  function params(lim) {
    const p = {
      ':city': $('city').value,
      ':channel': $('channel').value,
      ':month': $('month').value,
      ':status': $('status').value,
    };
    if (lim !== undefined) p[':lim'] = lim;
    return p;
  }

  // Display only: substitute bound values into the template text.
  function substituted(sql, p) {
    return sql.replace(/:(\w+)/g, (m) => {
      const v = p[m];
      return typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
    });
  }

  function fillSelect(id, values) {
    const sel = $(id);
    sel.innerHTML = '';
    ['All'].concat(values).forEach((v) => {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
    sel.disabled = false;
  }

  function currentResult() {
    const count = run(SQL_COUNT, params())[0][0];
    const preview = run(SQL_ROWS, params(PREVIEW_LIMIT));
    return { count, preview };
  }

  function render() {
    const { count, preview } = currentResult();
    $('count').textContent = count.toLocaleString('en-US');
    const shown = substituted(SQL_COUNT, params()) + ';\n\n' + substituted(SQL_ROWS, params(PREVIEW_LIMIT)) + ';';
    $('sql').textContent = shown;

    const table = $('preview');
    table.innerHTML = '';
    const head = table.createTHead().insertRow();
    COLUMNS.forEach((c) => { const th = document.createElement('th'); th.textContent = c; head.appendChild(th); });
    const body = table.createTBody();
    preview.forEach((r) => {
      const tr = body.insertRow();
      r.forEach((v) => { tr.insertCell().textContent = v === null ? '' : v; });
    });

    const trunc = $('trunc');
    if (count > CSV_CAP) {
      trunc.hidden = false;
      trunc.textContent = `CSV is capped at ${CSV_CAP.toLocaleString('en-US')} rows: it will contain ${CSV_CAP.toLocaleString('en-US')} of ${count.toLocaleString('en-US')} matching customers.`;
    } else {
      trunc.hidden = true;
    }
    $('download').disabled = count === 0;
  }

  function buildCsv() {
    const rows = run(SQL_ROWS, params(CSV_CAP));
    const text = [COLUMNS.join(',')].concat(rows.map((r) => r.map(csvEscape).join(','))).join('\r\n') + '\r\n';
    return { text, rowCount: rows.length };
  }

  function download() {
    const { text, rowCount } = buildCsv();
    window.__lastCsv = { text, rowCount };
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'swish_customers.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  async function init() {
    try {
      const [SQL, resp] = await Promise.all([
        initSqlJs({ locateFile: (f) => 'vendor/' + f }),
        fetch('data/customers.csv'),
      ]);
      if (!resp.ok) throw new Error('Could not load data/customers.csv (' + resp.status + ')');
      const { header, rows } = parseCsv(await resp.text());
      if (header.join(',') !== COLUMNS.join(',')) throw new Error('Unexpected CSV columns: ' + header.join(','));

      db = new SQL.Database();
      db.run('CREATE TABLE customers (customer_id INTEGER, city TEXT, channel TEXT, signup_month TEXT, order_count INTEGER, last_order_date TEXT)');
      db.run('BEGIN');
      const ins = db.prepare('INSERT INTO customers VALUES (?,?,?,?,?,?)');
      rows.forEach((r) => ins.run([Number(r[0]), r[1], r[2], r[3], Number(r[4]), r[5] === '' ? null : r[5]]));
      ins.free();
      db.run('COMMIT');

      const distinct = (col) => run(`SELECT DISTINCT ${col} FROM customers ORDER BY ${col}`, {}).map((r) => r[0]);
      fillSelect('city', distinct('city'));
      fillSelect('channel', distinct('channel'));
      fillSelect('month', distinct('signup_month'));
      fillSelect('status', STATUSES.slice(1));
      ['city', 'channel', 'month', 'status'].forEach((id) => $(id).addEventListener('change', render));
      $('download').addEventListener('click', download);
      $('status-msg').textContent = `Loaded ${rows.length.toLocaleString('en-US')} customers.`;
      render();

      // Hooks for automated checks.
      window.__genie = {
        set(f) { Object.keys(f).forEach((k) => { $(k).value = f[k]; }); render(); },
        count: () => currentResult().count,
        displayedCount: () => Number($('count').textContent.replace(/,/g, '')),
        csv: buildCsv,
      };
      window.__ready = true;
    } catch (e) {
      $('status-msg').textContent = 'Error: ' + e.message;
    }
  }

  init();
})();
