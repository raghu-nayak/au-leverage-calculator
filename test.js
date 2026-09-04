var fs = require('fs');
var src = fs.readFileSync(process.argv[2] || (__dirname + '/engine.js'), 'utf8');
var m = src.indexOf('/* --- engine:start --- */'), n = src.indexOf('/* --- engine:end --- */');
if (m < 0 || n < 0) throw new Error('engine markers not found');
var code = src.slice(m, n);
var api = new Function(code + '\nreturn {clamp:clamp,bracketTax:bracketTax,lito:lito,medicareLevy:medicareLevy,' +
  'mlsRate:mlsRate,incomeTax:incomeTax,marginalRate:marginalRate,frankingOn:frankingOn,pmt:pmt,' +
  'project:project,monteCarlo:monteCarlo,breakeven:breakeven,exitValue:exitValue,TAX:TAX};')();

var pass = 0, fail = 0;
function near(a, b, tol){ return Math.abs(a - b) <= (tol == null ? 0.5 : tol); }
function ck(name, got, want, tol){
  if (near(got, want, tol)){ pass++; }
  else { fail++; console.log('FAIL  ' + name + '\n      got ' + got + '  want ' + want); }
}
function ckTrue(name, cond, extra){
  if (cond){ pass++; }
  else { fail++; console.log('FAIL  ' + name + (extra != null ? '  [' + extra + ']' : '')); }
}
function head(s){ console.log('\n' + s); }

var IT = { ix: 1, family: false, cover: true };
var NC = { ix: 1, family: false, cover: false };

/* ---------------------------------------------------------------- tax */
head('income tax, FY ' + api.TAX.financialYear);
ck('nothing earned, nothing owed', api.incomeTax(0, IT), 0);
ck('the tax-free threshold is free', api.incomeTax(18200, IT), 0);
ck('$45,000: $4,020 bracket less $325 LITO plus $900 levy', api.incomeTax(45000, IT), 4595, 0.01);
ck('$135,000, with hospital cover', api.incomeTax(135000, IT), 33720, 0.01);
ck('$135,000, without cover: 1.25% surcharge on top', api.incomeTax(135000, NC), 33720 + 1687.5, 0.01);
ck('the lowest positive rate is 15c', api.bracketTax(19200, 1), 150, 0.01);
ck('LITO is gone by $66,667', api.lito(66667, 1), 0, 0.01);
ck('the levy shades in at 10c', api.medicareLevy(29011, false, 1), 100, 0.01);
ck('and tops out at the flat 2%', api.medicareLevy(60000, false, 1), 1200, 0.01);
ck('marginal rate at $130,000 is 30c + levy', api.marginalRate(130000, IT), 0.32, 1e-9);
ck('marginal rate at $250,000 is 45c + levy', api.marginalRate(250000, IT), 0.47, 1e-9);
ck('$1,000 fully franked carries a $428.57 credit', api.frankingOn(1000, 1), 428.5714, 0.001);
ck('half-franked, half the credit', api.frankingOn(1000, 0.5), 214.2857, 0.001);
ck('thresholds index with ix', api.bracketTax(36400, 2), 0, 0.01);

head('the surcharge add-back');
/* $110k salary, $10k of deductible interest, no investment income. Taxable
   income falls to $100k — under the tier-1 line — but MLS income is the
   $110k, so the surcharge is charged anyway. */
ck('a net investment loss does not dodge the surcharge',
   api.incomeTax(100000, { ix:1, family:false, cover:false, mlsInc:110000 }) -
   api.incomeTax(100000, { ix:1, family:false, cover:true }), 1000, 0.01);
ckTrue('and it would have been dodged if MLS used taxable income',
   api.mlsRate(100000, false, 1) === 0 && api.mlsRate(110000, false, 1) === 0.01);
ck('family thresholds are double the single ones at tier 1',
   api.mlsRate(210000, true, 1), 0.01, 1e-12);

head('level repayments');
ck('a 0% loan just divides', api.pmt(300000, 0, 30), 10000, 0.01);
ck('$500k at 6% over 30 years', api.pmt(500000, 0.06, 30), 36324.9, 0.5);
ck('no loan, no repayment', api.pmt(0, 0.06, 30), 0);

/* ---------------------------------------------------------------- params */
function P(o){
  return Object.assign({
    mode:'recycle', years:20, salary:180000, salaryGrowth:0.02,
    family:false, cover:true,
    ret:0.08, divYield:0.03, franked:0.7, fee:0.002, vol:0.15,
    inflation:0.025, indexTax:true, indexSurplus:false,
    surplus:30000, directTax:true,
    homeBal:600000, homeRate:0.06, homeTerm:25, recyclePrin:true, lumpSum:0,
    borrow:0, invRate:0.065, io:true, loanTerm:20,
    ownCap:200000, lvrTarget:0.5, marginRate:0.085, maxLvr:0.7, buffer:0.05, topUp:false
  }, o || {});
}

head('debt recycling');
var rc = api.project(P());
ck('twenty years of rows', rc.rows.length, 20);
var d0 = rc.rows[0].debt;
ckTrue('recycling the principal keeps the total debt flat while there is a home loan to eat',
  rc.rows.filter(function(r){ return r.home > 1 && Math.abs(r.debt - 600000) > 1; }).length === 0,
  'first drift: ' + JSON.stringify(rc.rows.filter(function(r){ return r.home > 1 && Math.abs(r.debt - 600000) > 1; })[0] || null));
var shares = rc.rows.map(function(r){ return r.dedShare; });
ckTrue('the deductible share only ever goes up',
  shares.every(function(v, i){ return i === 0 || v >= shares[i-1] - 1e-9; }));
ckTrue('and gets all the way to every dollar', rc.rows[rc.rows.length-1].dedShare > 0.999,
  rc.rows[rc.rows.length-1].dedShare);
ckTrue('the home loan is gone by the end', rc.home < 1, rc.home);
ckTrue('the portfolio is worth more than the debt it bought', rc.port > rc.debt, rc.port + ' vs ' + rc.debt);
ckTrue('a tax saving shows up every year the interest is deductible',
  rc.rows.slice(1).every(function(r){ return r.saved > 0; }));

var idle = api.project(P({ surplus:0, lumpSum:0, recyclePrin:false, years:5 }));
ckTrue('nothing to recycle means nothing invested', idle.port === 0 && idle.inv === 0);
ck('and the home loan just amortises', idle.rows[0].home,
   600000 - (api.pmt(600000, 0.06, 25) - 36000), 0.01);
ckTrue('with no strategy at all the two sides are identical',
  Math.abs(idle.exitLev - idle.exitBase) < 0.01, idle.exitLev + ' vs ' + idle.exitBase);

/* surplus set to exactly the split's interest, so nothing but the lump moves */
var lump = api.project(P({ lumpSum:100000, years:1, recyclePrin:false, divYield:0,
                           directTax:false, surplus:6500 }));
ck('a lump sum converts on day one', lump.rows[0].inv, 100000, 0.01);
ck('and the deductible interest is charged on it', lump.rows[0].invInt, 6500, 0.01);
ck('the plain side just banks it against the loan', lump.rows[0].bPort, 0, 0.01);
var lump2 = api.project(P({ lumpSum:100000, years:1 }));
ckTrue('recycling a lump does not change the total debt', Math.abs(lump2.rows[0].debt - 600000) < 1,
  lump2.rows[0].debt);

head('the benefit rises with the return (the bisection depends on it)');
var prev = -Infinity, mono = true, worst = null;
[-0.10, -0.05, 0, 0.03, 0.05, 0.07, 0.09, 0.12, 0.15, 0.20].forEach(function(r){
  var b = api.project(P({ ret:r })).benefit;
  if (b < prev - 1) { mono = false; worst = r + ': ' + b + ' after ' + prev; }
  prev = b;
});
ckTrue('monotone in the return', mono, worst);
var be = api.breakeven(P());
ckTrue('a breakeven return exists inside the search range', be.rate > -0.2 && be.rate < 0.4, be.rate);
ck('and the benefit there is nil', api.project(P({ ret:be.rate })).benefit, 0, 60);
ckTrue('below it the borrowing costs you', api.project(P({ ret:be.rate - 0.01 })).benefit < 0);
ckTrue('above it the borrowing pays', api.project(P({ ret:be.rate + 0.01 })).benefit > 0);

head('borrow against the house');
var eq0 = api.project(P({ mode:'equity', borrow:0 }));
ckTrue('borrowing nothing is the same as not borrowing',
  Math.abs(eq0.exitLev - eq0.exitBase) < 0.01, eq0.exitLev + ' vs ' + eq0.exitBase);
var eqIO = api.project(P({ mode:'equity', borrow:250000, io:true }));
ckTrue('an interest-only loan never shrinks',
  eqIO.rows.every(function(r){ return Math.abs(r.inv - 250000) < 1; }), eqIO.inv);
var eqPI = api.project(P({ mode:'equity', borrow:250000, io:false, loanTerm:20 }));
ckTrue('a P&I loan is repaid over its term', eqPI.inv < 1, eqPI.inv);
ckTrue('and pays less interest doing it',
  eqPI.rows.reduce(function(a,r){ return a + r.invInt; }, 0) <
  eqIO.rows.reduce(function(a,r){ return a + r.invInt; }, 0));
ckTrue('at 12% the loan is worth having', api.project(P({ mode:'equity', borrow:250000, ret:0.12 })).benefit > 0);
ckTrue('at 1% it is not', api.project(P({ mode:'equity', borrow:250000, ret:0.01 })).benefit < 0);

head('margin loans');
var m0 = api.project(P({ mode:'margin', lvrTarget:0 }));
ckTrue('a zero LVR is just an unleveraged portfolio',
  Math.abs(m0.exitLev - m0.exitBase) < 0.01, m0.exitLev + ' vs ' + m0.exitBase);
/* surplus exactly equal to the interest, so the position sits still */
var mFlat = api.project(P({ mode:'margin', years:1, ret:0, divYield:0, fee:0, lvrTarget:0.5,
                            surplus:17000, directTax:false }));
ck('and the loan is own capital times L/(1-L)', mFlat.inv, 200000, 1);
ck('the opening LVR is the target', mFlat.rows[0].lvr, 0.5, 1e-6);
ck('a year that exactly pays its own interest sells nothing', mFlat.sold, 0, 0.01);
var starve = api.project(P({ mode:'margin', years:1, ret:0, divYield:0, fee:0, lvrTarget:0.5,
                             surplus:0, directTax:false }));
ckTrue('and one that pays nothing sells units to cover it', starve.sold > 16000, starve.sold);
var mCall = api.project(P({ mode:'margin', years:1, ret:-0.25, divYield:0, fee:0,
                            lvrTarget:0.6, surplus:25500, directTax:false }));
ckTrue('a 25% fall on a 60% LVR takes it past 70% + 5%', mCall.everCall, mCall.worstLvr);
ck('the call is settled back to the maximum LVR, not the buffer', mCall.rows[0].lvr, 0.7, 1e-6);
ck('and the sale is enough to move both sides of the ratio', mCall.sold, 125000, 1);
var mWipe = api.project(P({ mode:'margin', years:1, ret:-0.45, divYield:0, fee:0,
                            lvrTarget:0.6, surplus:25500, directTax:false }));
ckTrue('a 45% fall wipes the position out and leaves the debt behind',
  mWipe.port < 1 && mWipe.inv > 1000, mWipe.port + ' / ' + mWipe.inv);
var mSafe = api.project(P({ mode:'margin', years:1, ret:-0.25, divYield:0, fee:0,
                            lvrTarget:0.6, surplus:25500, directTax:false,
                            maxLvr:0.95, buffer:0.05 }));
ckTrue('no call when the lender allows almost the whole portfolio', !mSafe.everCall, mSafe.worstLvr);
ck('and nothing is sold', mSafe.sold, 0, 0.01);
var mTop = api.project(P({ mode:'margin', years:10, topUp:true, lvrTarget:0.5 }));
ckTrue('gearing up holds the LVR on the target, not near it',
  mTop.rows.every(function(r){ return Math.abs(r.lvr - 0.5) < 1e-9; }),
  mTop.rows.map(function(r){ return r.lvr.toFixed(6); }).join(' '));
ckTrue('and borrows more than a fixed loan would',
  mTop.inv > api.project(P({ mode:'margin', years:10, topUp:false })).inv);

head('selling to cover a shortfall');
var tight = api.project(P({ mode:'equity', borrow:400000, io:true, surplus:0, divYield:0,
                            ret:0.01, years:5, directTax:false }));
ckTrue('a year that cannot pay its interest sells units', tight.sold > 0, tight.sold);
ckTrue('and the cost base falls with them', tight.rows[0].cost < 400000, tight.rows[0].cost);

head('exit value');
ck('no gain, nothing to pay', api.exitValue(100000, 100000, 40000, 180000, 1, P(), 0.5), 60000, 0.01);
/* $180k salary plus a $50k discounted gain: $10k of it at 37%, $40k at 45%,
   and the 2% levy on the lot — $22,700, not a flat marginal rate on $50k. */
ck('a discounted gain is taxed across the brackets it straddles',
   api.exitValue(200000, 100000, 0, 180000, 1, P(), 0.5), 200000 - 22700, 1);
ck('the discount halves the assessable gain',
   api.exitValue(200000, 100000, 0, 60000, 1, P(), 0.5),
   200000 - (api.incomeTax(110000, IT) - api.incomeTax(60000, IT)), 1);
ckTrue('a loss is not a credit', api.exitValue(80000, 100000, 0, 180000, 1, P(), 0.5) === 80000);

head('a thousand other markets');
var mp = P({ years:15 });
var mc1 = api.monteCarlo(mp, 200), mc2 = api.monteCarlo(mp, 200);
ckTrue('the same inputs draw the same fan',
  JSON.stringify(mc1.bands) === JSON.stringify(mc2.bands));
ckTrue('the bands are in order', mc1.bands.every(function(_, b){
  return b === 0 || mc1.bands[b].every(function(v, y){ return v >= mc1.bands[b-1][y] - 1e-6; });
}));
ckTrue('the ahead rate is a probability', mc1.aheadRate >= 0 && mc1.aheadRate <= 1, mc1.aheadRate);
ckTrue('ahead, behind and level account for every path',
  mc1.ahead + mc1.behind + mc1.tied === mc1.paths,
  mc1.ahead + '+' + mc1.behind + '+' + mc1.tied + ' vs ' + mc1.paths);
/* A scenario the borrowing cannot change must read as level, not as a loss.
   Every rate at zero and no volatility: recycling moves a dollar of debt from
   one column to the other and buys a dollar of assets, which is exactly what
   paying the dollar off the loan does. Both sides land on the same figure. */
var nilP = P({ years:10, ret:0, divYield:0, fee:0, invRate:0, homeRate:0, vol:0, surplus:20000 });
ck('and the two sides agree to the cent', api.project(nilP).benefit, 0, 0.01);
var nil = api.monteCarlo(nilP, 50);
ckTrue('so every path is counted level, not behind',
  nil.tiedRate === 1 && nil.behindRate === 0 && nil.aheadRate === 0,
  'ahead ' + nil.aheadRate + ' behind ' + nil.behindRate + ' tied ' + nil.tiedRate);
/* Volatility alone is enough to separate them: the geared side holds more
   assets, so the same good year is worth more to it. */
ckTrue('but volatility alone separates them again',
  api.monteCarlo(Object.assign({}, nilP, { vol: 0.15 }), 200).tiedRate < 0.2);
ckTrue('the benefit percentiles are ordered',
  mc1.benefit.worst <= mc1.benefit.p10 && mc1.benefit.p10 <= mc1.benefit.p50 &&
  mc1.benefit.p50 <= mc1.benefit.p90 && mc1.benefit.p90 <= mc1.benefit.best,
  JSON.stringify(mc1.benefit));
ckTrue('and the median benefit sits near the steady one',
  Math.abs(mc1.benefit.p50 - api.project(mp).benefit) < Math.abs(api.project(mp).benefit) * 0.6 + 5000,
  mc1.benefit.p50 + ' vs ' + api.project(mp).benefit);
ckTrue('a losing market shows up as a negative benefit somewhere',
  mc1.benefit.worst < 0, mc1.benefit.worst);
var flat = api.monteCarlo(P({ years:15, vol:0 }), 30);
var det = api.project(P({ years:15 }));
/* the fan is measured the same way the lines over it are: after tax, after
   clearing the debt */
ckTrue('with no volatility every path is the steady one',
  Math.abs(flat.bands[0][15] - det.exitLev) < 1 && Math.abs(flat.bands[4][15] - det.exitLev) < 1,
  flat.bands[0][15] + ' vs ' + det.exitLev);
ckTrue('and both ledgers open on the same net position',
  Math.abs(det.open - (det.p.lumpSum - det.p.homeBal)) < 0.01, det.open);
ck('and every path is ahead or none is', flat.aheadRate, det.benefit > 0 ? 1 : 0, 1e-9);
var mcMargin = api.monteCarlo(P({ mode:'margin', years:15, lvrTarget:0.65, vol:0.20 }), 300);
ckTrue('a 65% LVR gets called sometimes', mcMargin.callRate > 0, mcMargin.callRate);
ckTrue('a 20% LVR does not',
  api.monteCarlo(P({ mode:'margin', years:15, lvrTarget:0.2, vol:0.15 }), 300).callRate === 0);

head('the same market on both sides');
var seq = new Float64Array(10);
for (var i = 0; i < 10; i++) seq[i] = (i % 3 === 0 ? -0.2 : 0.1);
var a = api.project(P({ years:10 }), { returns:seq });
var b = api.project(P({ years:10 }), { returns:seq });
ckTrue('a supplied return sequence is honoured deterministically', a.net === b.net);
var noLev = api.project(P({ years:10, mode:'equity', borrow:0 }), { returns:seq });
ckTrue('and with no gearing both ledgers track each other exactly',
  Math.abs(noLev.exitLev - noLev.exitBase) < 0.01, noLev.exitLev + ' vs ' + noLev.exitBase);

head('the repayment that frees up when a loan is repaid');
var fr = api.project(P({ years:25 }));
var firstFree = fr.rows.filter(function(r){ return r.freed > 1; })[0];
ckTrue('nothing frees up while the home loan is still there',
  fr.rows.every(function(r){ return r.home < 1 || r.freed < 1; }));
ckTrue('and the whole repayment frees up once it is gone',
  firstFree && Math.abs(fr.rows[fr.rows.length-1].freed - api.pmt(600000, 0.06, 25)) < 0.01,
  firstFree ? firstFree.freed : 'never freed');
/* The plain side clears the loan years earlier, so if the freed repayment
   were credited to only one side the comparison would be worthless. */
ckTrue('crediting it to both sides cuts the strategy down to size',
  api.project(P({ years:25 })).benefit < 700000, api.project(P({ years:25 })).benefit);

head('edge cases the sliders can actually reach');
ck('one year is a legal horizon', api.project(P({ years:1 })).rows.length, 1);
ckTrue('no home loan to recycle: nothing happens on either side',
  Math.abs(api.project(P({ homeBal:0, lumpSum:0 })).benefit) < 0.01);
ckTrue('a home loan and no surplus still recycles the scheduled principal',
  api.project(P({ surplus:0, recyclePrin:true, years:5 })).inv > 0);
ckTrue('and does not if that is switched off',
  api.project(P({ surplus:0, lumpSum:0, recyclePrin:false, years:5 })).inv === 0);
ckTrue('a zero salary pays no tax and still runs',
  isFinite(api.project(P({ salary:0, years:5 })).benefit));
ckTrue('a $2m salary is on the top rate throughout',
  api.project(P({ salary:2000000, years:5 })).rows.every(function(r){ return r.taxSalary > 800000; }));
ckTrue('a yield larger than the total return means the capital shrinks',
  api.project(P({ ret:0.02, divYield:0.06, years:5 })).rows.every(function(r){ return r.g === 0.02; }));
ckTrue('unfranked dividends carry no credit',
  api.project(P({ franked:0, years:3 })).rows.every(function(r){ return r.frk === 0; }));
ckTrue('fully franked dividends do',
  api.project(P({ franked:1, years:3 })).rows.every(function(r){ return r.frk > 0; }));
ckTrue('the surcharge makes the deduction worth more, not less',
  api.project(P({ cover:false, years:10 })).benefit > 0);
ckTrue('frozen brackets drag you up them',
  api.project(P({ indexTax:false, years:20 })).rows[19].taxSalary >
  api.project(P({ indexTax:true,  years:20 })).rows[19].taxSalary);
ckTrue('an indexed surplus contributes more than a flat one',
  api.project(P({ indexSurplus:true, years:20 })).port >
  api.project(P({ indexSurplus:false, years:20 })).port);
var brutal = api.project(P({ mode:'margin', lvrTarget:0.7, maxLvr:0.7, buffer:0, ret:-0.3, years:3,
                             surplus:0 }));
ckTrue('a zero buffer calls on the first bad year', brutal.calls.length > 0 && brutal.calls[0].y === 1);
ckTrue('and a position that cannot pay is left owing money with nothing behind it',
  brutal.unfunded >= 0 && isFinite(brutal.unfunded), brutal.unfunded);

head('every number stays a number');
var bad = [];
var grid = [];
['recycle','equity','margin'].forEach(function(mode){
  [1, 7, 40].forEach(function(years){
    [-0.15, 0, 0.08, 0.30].forEach(function(ret){
      [0, 0.06, 0.20].forEach(function(divYield){
        [0, 250000, 2000000].forEach(function(salary){
          grid.push({ mode:mode, years:years, ret:ret, divYield:divYield, salary:salary });
        });
      });
    });
  });
});
/* the awkward corners on top of the grid */
[{ homeBal:0 }, { homeBal:5000000, surplus:0 }, { surplus:500000 }, { lumpSum:600000 },
 { borrow:2000000, io:false, loanTerm:1 }, { ownCap:0 }, { lvrTarget:0.9, maxLvr:0.1, buffer:0 },
 { homeRate:0.20, invRate:0.20, marginRate:0.20 }, { homeRate:0, invRate:0, marginRate:0 },
 { fee:0.05 }, { franked:1, cover:false }, { indexTax:false, salaryGrowth:0.10 },
 { recyclePrin:false, directTax:false }, { homeTerm:1 }, { topUp:true, lvrTarget:0.8 }
].forEach(function(o){ grid.push(Object.assign({ years:25 }, o)); });

grid.forEach(function(o){
  var r;
  try { r = api.project(P(o)); }
  catch(e){ bad.push(JSON.stringify(o) + ' threw ' + e.message); return; }
  ['port','cost','inv','home','net','exitLev','exitBase','benefit','worstLvr','sold','unfunded']
    .forEach(function(k){ if (!isFinite(r[k])) bad.push(JSON.stringify(o) + ' -> ' + k + '=' + r[k]); });
  r.rows.forEach(function(row){
    Object.keys(row).forEach(function(k){
      var v = row[k];
      if (typeof v === 'number' && !isFinite(v)) bad.push(JSON.stringify(o) + ' y' + row.y + ' ' + k + '=' + v);
    });
    if (row.port < -0.001) bad.push(JSON.stringify(o) + ' y' + row.y + ' negative portfolio ' + row.port);
    if (row.home < -0.001) bad.push(JSON.stringify(o) + ' y' + row.y + ' negative home loan ' + row.home);
    if (row.inv  < -0.001) bad.push(JSON.stringify(o) + ' y' + row.y + ' negative investment loan ' + row.inv);
    if (row.lvr  < -0.001) bad.push(JSON.stringify(o) + ' y' + row.y + ' negative LVR ' + row.lvr);
  });
});
ckTrue(grid.length + ' scenarios produce only finite, non-negative balances',
  bad.length === 0, bad.slice(0, 6).join(' | '));

head('the fixed point actually settles');
/* If it had not converged the year's cash would not balance. Everything that
   came in has to equal everything that went out, to the cent, in every mode:
     surplus + dividends + tax saved + units sold + unpaid
   goes on
     deductible interest + loan principal + recycled + bought + last year's CGT
*/
var leak = [];
['recycle','equity','margin'].forEach(function(mode){
  [P({ mode:mode, borrow:250000, years:14 }),
   P({ mode:mode, borrow:900000, years:14, surplus:0, ret:0.01 }),
   P({ mode:mode, borrow:250000, years:14, directTax:false, io:false }),
   P({ mode:mode, years:14, lvrTarget:0.7, ret:-0.12, vol:0 })].forEach(function(pp, k){
    var r = api.project(pp);
    r.rows.forEach(function(w){
      /* units the lender took go straight against the loan, so they are not
         part of the year's spendable cash — only the shortfall sale is */
      var inC  = w.surplus + w.freed + w.divs + (pp.directTax ? w.saved : 0) + w.need + w.unfunded;
      var outC = w.invInt + w.invPrin + w.recycled + w.buy + w.cgtPaid
               - (pp.mode === 'recycle' && pp.recyclePrin ? w.schedPrin : 0);
      if (Math.abs(inC - outC) > 0.02) leak.push(mode + '/' + k + ' y' + w.y +
        ': in ' + inC.toFixed(2) + ' out ' + outC.toFixed(2));
    });
  });
});
ckTrue('the year balances to the cent in every mode', leak.length === 0, leak.slice(0, 5).join(' | '));

/* And a forced sale has to land the ratio exactly on the limit. */
/* Gearing up holds the LVR on 68% year after year, so the shock lands on a
   fully geared position rather than one the market has quietly de-risked. */
var callRows = api.project(P({ mode:'margin', years:20, lvrTarget:0.68, topUp:true, vol:0 }),
  { returns: (function(){ var a = new Float64Array(20); a[3] = -0.30; a[11] = -0.30; return a; })() }).rows;
var called = callRows.filter(function(r){ return r.call; });
ckTrue('a bad year in the middle of a run still triggers the call', called.length === 2, called.length);
ckTrue('and a portfolio that drifted down to a safe LVR first does not',
  api.project(P({ mode:'margin', years:20, lvrTarget:0.68, topUp:false, vol:0 }),
    { returns: (function(){ var a = new Float64Array(20); a[11] = -0.30; return a; })() })
  .rows.filter(function(r){ return r.call; }).length === 0);
ckTrue('and every call lands the LVR on the maximum',
  called.every(function(r){ return Math.abs(r.lvr - 0.7) < 1e-9; }),
  called.map(function(r){ return r.lvr; }).join(' '));
ckTrue('the lender takes exactly what it sold',
  called.every(function(r){ return r.callSold > 0; }));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
