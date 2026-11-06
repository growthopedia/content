
(function(){
  var prose = document.querySelector(".prose2"); if (!prose) return;
  function store(k, v){ try { if (v === undefined) return JSON.parse(localStorage.getItem(k) || "null"); localStorage.setItem(k, JSON.stringify(v)); } catch(e){ return null; } }
  // tables scroll inside their own box on phones
  prose.querySelectorAll("table.gk-table").forEach(function(t){ if (t.parentNode.classList.contains("gk-tablewrap")) return; var w=document.createElement("div"); w.className="gk-tablewrap"; t.parentNode.insertBefore(w,t); w.appendChild(t); });
  // checklists
  prose.querySelectorAll("ul.gk-check").forEach(function(ul, n){
    var key = "gk-check:" + location.pathname + ":" + (ul.getAttribute("data-check") || n), saved = store(key) || {};
    var items = Array.prototype.slice.call(ul.children);
    items.forEach(function(li, i){
      var lab = document.createElement("label"), box = document.createElement("input"), span = document.createElement("span");
      box.type = "checkbox"; box.checked = !!saved[i]; while (li.firstChild) span.appendChild(li.firstChild);
      if (box.checked) span.className = "gk-done";
      box.addEventListener("change", function(){ saved[i] = box.checked; span.className = box.checked ? "gk-done" : ""; store(key, saved); upd(); });
      lab.appendChild(box); lab.appendChild(span); li.appendChild(lab);
    });
    var bar = document.createElement("div"); bar.className = "gk-progress";
    bar.innerHTML = '<span class="gk-count"></span><i><b></b></i><button type="button">Reset</button><button type="button">Print</button>';
    ul.parentNode.insertBefore(bar, ul.nextSibling);
    var btns = bar.querySelectorAll("button");
    btns[0].addEventListener("click", function(){ saved = {}; store(key, saved); ul.querySelectorAll("input").forEach(function(b){ b.checked = false; b.nextSibling.className = ""; }); upd(); });
    btns[1].addEventListener("click", function(){ window.print(); });
    function upd(){ var done = ul.querySelectorAll("input:checked").length; bar.querySelector(".gk-count").textContent = done + " of " + items.length + " done"; bar.querySelector("b").style.width = (100 * done / items.length) + "%"; }
    upd();
  });
  // yes/no self-checks
  prose.querySelectorAll(".gk-score").forEach(function(box){
    var lis = Array.prototype.slice.call(box.querySelectorAll(":scope > ul > li")), ans = {};
    var res = document.createElement("div"); res.className = "gk-result"; res.setAttribute("role", "status");
    lis.forEach(function(li, i){
      var yn = document.createElement("span"); yn.className = "gk-yn";
      ["Yes", "No"].forEach(function(t){ var b = document.createElement("button"); b.type = "button"; b.textContent = t; b.setAttribute("aria-pressed", "false");
        b.addEventListener("click", function(){ ans[i] = t === "Yes"; yn.querySelectorAll("button").forEach(function(x){ x.setAttribute("aria-pressed", String(x === b)); }); upd(); }); yn.appendChild(b); });
      li.appendChild(yn);
    });
    box.appendChild(res);
    function upd(){
      var tot = 0, got = 0, answered = 0;
      lis.forEach(function(li, i){ var w = parseFloat(li.getAttribute("data-w") || "1"); tot += w; if (i in ans) { answered++; if (ans[i]) got += w; } });
      if (!answered) { res.innerHTML = "<p>Answer the questions to see your score.</p>"; return; }
      var pct = Math.round(100 * got / tot), pick = null;
      box.querySelectorAll("[data-min]").forEach(function(p){ var m = parseFloat(p.getAttribute("data-min")); if (pct >= m && (!pick || m > parseFloat(pick.getAttribute("data-min")))) pick = p; });
      res.innerHTML = '<strong class="gk-big">' + pct + '%</strong><p>' + (answered < lis.length ? "So far, " + answered + " of " + lis.length + " answered. " : "") + '</p>';
      if (pick) { var p = document.createElement("p"); p.innerHTML = pick.innerHTML; res.appendChild(p); }
    }
    upd();
  });
  // calculators: formula uses input names, numbers, + - * / ( ) and min/max/round
  function evaluate(expr, vars){
    var toks = expr.match(/\d+\.?\d*|[a-z_][a-z0-9_]*|[-+*/(),]/gi) || [], i = 0;
    function peek(){ return toks[i]; } function next(){ return toks[i++]; }
    function prim(){ var t = next();
      if (t === "(") { var v = add(); next(); return v; }
      if (t === "-") return -prim();
      if (/^[\d.]+$/.test(t)) return parseFloat(t);
      if (/^(min|max|round)$/i.test(t)) { next(); var a = [add()]; while (peek() === ",") { next(); a.push(add()); } next(); return Math[t.toLowerCase()].apply(null, a); }
      if (t in vars) return vars[t]; return NaN; }
    function mul(){ var v = prim(); while (peek() === "*" || peek() === "/") { var o = next(), r = prim(); v = o === "*" ? v * r : v / r; } return v; }
    function add(){ var v = mul(); while (peek() === "+" || peek() === "-") { var o = next(), r = mul(); v = o === "+" ? v + r : v - r; } return v; }
    return add();
  }
  prose.querySelectorAll(".gk-calc").forEach(function(box){
    var fields = document.createElement("div"), inputs = {}; fields.className = "gk-fields";
    box.querySelectorAll("[data-in]").forEach(function(p){
      var name = p.getAttribute("data-in"), lab = document.createElement("label"), inp = document.createElement("input");
      inp.type = "number"; inp.inputMode = "decimal"; inp.value = p.getAttribute("data-value") || "0"; inp.step = p.getAttribute("data-step") || "any"; inp.min = "0";
      lab.textContent = p.textContent; lab.appendChild(inp); fields.appendChild(lab); inputs[name] = inp; p.remove(); inp.addEventListener("input", upd);
    });
    box.insertBefore(fields, box.firstChild);
    var out = box.querySelector("[data-out]"), res = document.createElement("div"); res.className = "gk-result"; res.setAttribute("role", "status"); box.appendChild(res);
    function upd(){
      var vars = {}; for (var k in inputs) vars[k] = parseFloat(inputs[k].value) || 0;
      var v = evaluate(box.getAttribute("data-formula") || "0", vars), d = parseInt((out && out.getAttribute("data-decimals")) || "0", 10);
      var txt = isFinite(v) ? v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
      var parts = (out ? out.textContent : "{}").split("{}");
      res.innerHTML = ""; var big = document.createElement("span"); big.className = "gk-big"; big.textContent = (parts[0] || "") + txt + (parts[1] || ""); res.appendChild(big);
      var note = box.getAttribute("data-note"); if (note) { var p = document.createElement("p"); p.textContent = note; res.appendChild(p); }
    }
    upd();
  });
  // copy buttons on templates
  prose.querySelectorAll(".gk-template").forEach(function(box){
    var pre = box.querySelector("pre"); if (!pre) return; var b = document.createElement("button"); b.type = "button"; b.textContent = "Copy";
    b.addEventListener("click", function(){ (navigator.clipboard ? navigator.clipboard.writeText(pre.innerText) : Promise.reject()).then(function(){ b.textContent = "Copied"; setTimeout(function(){ b.textContent = "Copy"; }, 1600); }, function(){}); });
    box.appendChild(b);
  });
  // bars
  prose.querySelectorAll(".gk-bars").forEach(function(box){
    var ps = box.querySelectorAll("p[data-v]"), max = 0;
    ps.forEach(function(p){ max = Math.max(max, parseFloat(p.getAttribute("data-max") || p.getAttribute("data-v")) || 0); });
    ps.forEach(function(p){ var v = parseFloat(p.getAttribute("data-v")) || 0, i = document.createElement("i"), b = document.createElement("b"), em = document.createElement("em");
      b.style.width = (max ? 100 * v / max : 0) + "%"; i.appendChild(b); em.textContent = p.getAttribute("data-label") || v; p.appendChild(i); p.appendChild(em); });
  });
})();
