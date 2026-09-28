/* Loads the report data from the database (admin-only), then starts the original screens. */
/* Hand this frame's storage writes to the app first, so what the screens save is kept in the database, not only here. */
try { if (parent !== window && parent.__declaraStore) parent.__declaraStore(window); } catch (e) {}
(async function () {
  var URL = "https://sikgwlhwsezrhiylfmnx.supabase.co", KEY = "sb_publishable_OlAqQqzr4PRb8sTOCf5JVg__j2VYqR6";
  var msg = function (t) { var el = document.getElementById("vxLoading"); if (el) el.textContent = t; };
  try {
    var sb = window.supabase.createClient(URL, KEY);
    var s = await sb.auth.getSession();
    if (!s.data || !s.data.session) { msg("Please sign in to Declara first."); return; }
    var rows = [];
    for (var from = 0; ; from += 20) {
      var r = await sb.from("reference_data").select("key,data").like("key", "lg:%").order("key").range(from, from + 19);
      if (r.error) throw r.error;
      rows = rows.concat(r.data || []);
      if (!r.data || r.data.length < 20) break;
    }
    if (!rows.length) { msg("Your account doesn\u2019t have access to these reports."); return; }
    var D = {}; rows.forEach(function (x) { D[x.key.slice(3)] = x.data; });
    /* The signed-in login's agency (row-level security returns only that one), for names on reports and exports. */
    var ag = await sb.from("agencies").select("name,short_name").maybeSingle();
    if (ag.data) D.AGENCY = ag.data;

    /* Books: use the live book tables (the same records as the P&C book pages), not the old snapshot. */
    async function all(table) {
      var out = [];
      for (var f = 0; ; f += 1000) {
        var q = await sb.from(table).select("*").order("id").range(f, f + 999);
        if (q.error) throw q.error;
        out = out.concat(q.data || []);
        if (!q.data || q.data.length < 1000) break;
      }
      return out;
    }
    try {
      var accts = await all("book_accounts"), pols = await all("book_policies");
      if (accts.length) {
        var by = {}; pols.forEach(function (p) { (by[p.account_id] = by[p.account_id] || []).push(p); });
        var farmers = [], commercial = [], cb = [], rb = [];
        var r2 = function (n) { return Math.round(n * 100) / 100; };
        accts.forEach(function (a) {
          var ps = by[a.id] || [];
          if (a.book === "farmers") {
            var list = ps.map(function (p) { return Object.assign({}, p.data); });
            farmers.push(Object.assign({ id: a.id.replace(/^f-/, ""), name: a.name }, a.dba ? { dba: a.dba } : {}, a.data,
              { policies: list, totalPremium: r2(list.reduce(function (t, p) { return t + (Number(p.annualPremium) || 0); }, 0)), policyCount: list.length }));
          } else if (a.book === "commercial") {
            var locs = (a.data.locations || []).map(function (l) {
              return Object.assign({}, l, { policies: ps.filter(function (p) { return p.data.locationId === l.id; }).map(function (p) {
                var d = Object.assign({}, p.data); delete d.locationId; delete d.locationName; delete d.locationAddress; return d; }) });
            });
            commercial.push({ id: a.id.replace(/^c-/, ""), name: a.name, dba: a.dba, contact: a.contact, phone: a.phone, locations: locs });
          } else if (a.book === "brokered_commercial") {
            cb.push(Object.assign({ id: a.id.replace(/^bc-/, ""), name: a.name, dba: a.dba, contact: a.contact, phone: a.phone, address: a.address, producer: a.producer }, a.data));
          }
        });
        pols.forEach(function (p) { if (p.book === "brokered_personal") rb.push(Object.assign({}, p.data)); });
        farmers.sort(function (x, y) { return y.totalPremium - x.totalPremium; });
        D.DATA = { commercial: commercial, farmers: farmers };
        D.CB_BINDERS = cb;
        D.RB = rb;
        if (commercial[0]) D.CB_OWNER = { id: "owner-gas-stations", name: commercial[0].name, dba: commercial[0].dba, contact: commercial[0].contact, phone: commercial[0].phone, locations: 0, policies: 0, premium: 0 };
      }
    } catch (e) { console.warn("Book tables unavailable, using the saved copy", e); }
    window.__D = D;
    var sc = document.createElement("script");
    sc.src = "engine.js";
    sc.onerror = function () { msg("Couldn\u2019t load the reports. Refresh the page."); };
    document.body.appendChild(sc);
  } catch (e) { console.error(e); msg("Couldn\u2019t load the reports: " + (e.message || e)); }
})();
