// Banco de logos das redes sociais da clínica (cadastro da Clínica → Redes sociais).
// Usado pelo app (index.html), pela tela de login (js/pipo-supabase.js) e pela página
// pública do link de cadastro (cadastro.html). Ícones desenhados aqui (círculo na cor de
// cada rede + símbolo branco), sem depender de serviço externo.
(function(){
  var W = 'fill="#fff"', S = 'fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
  var LIST = [
    {id: "instagram", name: "Instagram", color: "#E1306C", ph: "https://instagram.com/suaclinica",
      g: '<rect x="6.5" y="6.5" width="11" height="11" rx="3.2" ' + S + '/><circle cx="12" cy="12" r="2.6" ' + S + '/><circle cx="15.3" cy="8.7" r=".9" ' + W + '/>'},
    {id: "facebook", name: "Facebook", color: "#1877F2", ph: "https://facebook.com/suaclinica",
      g: '<path ' + W + ' d="M13.2 19v-6h2l.3-2.4h-2.3V9.1c0-.7.2-1.2 1.2-1.2h1.2V5.8c-.2 0-.9-.1-1.8-.1-1.8 0-3 1.1-3 3.1v1.8H8.8V13h2v6z"/>'},
    {id: "youtube", name: "YouTube", color: "#FF0000", ph: "https://youtube.com/@suaclinica",
      g: '<rect x="5" y="7.5" width="14" height="9" rx="2.6" ' + W + '/><path fill="#FF0000" d="M10.6 9.8v4.4l3.8-2.2z"/>'},
    {id: "tiktok", name: "TikTok", color: "#111111", ph: "https://tiktok.com/@suaclinica",
      g: '<path ' + W + ' d="M13.4 5.5h2.1c.2 1.5 1.2 2.6 2.8 2.8v2.1c-1.1 0-2-.3-2.8-.9v4.4a3.6 3.6 0 1 1-3.6-3.6h.4v2.1a1.5 1.5 0 1 0 1.1 1.5z"/>'},
    {id: "whatsapp", name: "WhatsApp", color: "#25D366", ph: "(47) 99999-9999 ou https://wa.me/55…",
      g: '<path ' + S + ' d="M7.2 17.3l.9-2.6a5.5 5.5 0 1 1 2.1 1.9z"/><path ' + W + ' d="M10.2 9.3c.2-.4.6-.4.8 0l.5 1.1c.1.2 0 .4-.1.6l-.3.3c.4.8 1 1.4 1.8 1.8l.3-.3c.2-.2.4-.2.6-.1l1.1.5c.4.2.4.6 0 .8-.6.5-1.3.6-2 .3-1.5-.6-2.6-1.7-3.2-3.2-.2-.7-.1-1.3.5-1.8z"/>'},
    {id: "maps", name: "Google Maps", color: "#EA4335", ph: "https://maps.app.goo.gl/…",
      g: '<path ' + W + ' d="M12 5.4a4.4 4.4 0 0 0-4.4 4.4c0 3.3 4.4 8.6 4.4 8.6s4.4-5.3 4.4-8.6A4.4 4.4 0 0 0 12 5.4z"/><circle cx="12" cy="9.8" r="1.7" fill="#EA4335"/>'},
    {id: "site", name: "Site", color: "#4A5568", ph: "https://www.suaclinica.com.br",
      g: '<circle cx="12" cy="12" r="6" ' + S + '/><ellipse cx="12" cy="12" rx="2.6" ry="6" ' + S + '/><path ' + S + ' d="M6.2 10h11.6M6.2 14h11.6"/>'},
    {id: "linkedin", name: "LinkedIn", color: "#0A66C2", ph: "https://linkedin.com/company/suaclinica",
      g: '<rect x="7" y="10" width="2" height="7" ' + W + '/><circle cx="8" cy="7.6" r="1.15" ' + W + '/><path ' + W + ' d="M11 10h1.9v1c.4-.7 1.2-1.2 2.3-1.2 1.8 0 2.4 1.1 2.4 2.9V17h-2v-3.8c0-.9-.2-1.6-1.1-1.6s-1.5.6-1.5 1.6V17H11z"/>'},
    {id: "email", name: "E-mail", color: "#6B7280", ph: "contato@suaclinica.com.br",
      g: '<rect x="6" y="8" width="12" height="8.5" rx="1.5" ' + S + '/><path ' + S + ' d="M6.5 8.8l5.5 4.2 5.5-4.2"/>'},
    {id: "outro", name: "Outro", color: "#7C8794", ph: "https://…",
      g: '<path ' + S + ' d="M10.6 13.4l2.8-2.8M10 10.8l-1.3 1.3a2.5 2.5 0 0 0 3.5 3.5l1.3-1.3M14 13.2l1.3-1.3a2.5 2.5 0 0 0-3.5-3.5L10.5 9.7"/>'}
  ];
  var BY = {}; LIST.forEach(function(r){ BY[r.id] = r; });
  function esc(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]; }); }
  function get(id){ return BY[id] || BY.outro; }
  function icon(id, size){
    var r = get(id), n = size || 28;
    return '<svg class="soc-ico" width="' + n + '" height="' + n + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="12" fill="' + r.color + '"/>' + r.g + '</svg>';
  }
  // Link digitado → endereço que abre (só http/https/mailto). WhatsApp aceita só o número.
  function url(item){
    var v = String((item && item.url) || "").trim(); if (!v) return "";
    var id = item.rede;
    if (id === "whatsapp" && /^[\d\s()+.-]+$/.test(v)){
      var d = v.replace(/\D/g, ""); if (d.length < 10) return "";
      if (d.length <= 11) d = "55" + d;
      return "https://wa.me/" + d;
    }
    if (id === "email" || (/^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]+$/.test(v) && !/^https?:/i.test(v))){
      return /^[^\s@\/]+@[^\s@\/]+\.[^\s@\/]+$/.test(v.replace(/^mailto:/i, "")) ? "mailto:" + v.replace(/^mailto:/i, "") : "";
    }
    if (/^(javascript|data|vbscript|file):/i.test(v)) return "";
    if (!/^https?:\/\//i.test(v)) v = "https://" + v.replace(/^\/+/, "");
    try { var u = new URL(v); return /^https?:$/.test(u.protocol) && u.hostname.indexOf(".") > 0 ? u.href : ""; } catch (e) { return ""; }
  }
  function label(item){ var r = get(item.rede); return (item.rede === "outro" && String(item.nome || "").trim()) || r.name; }
  // Lista limpa: só as linhas com endereço válido.
  function clean(list){
    return (Array.isArray(list) ? list : []).map(function(it){
      return it && {rede: BY[it.rede] ? it.rede : "outro", nome: String(it.nome || "").trim().slice(0, 40), url: String(it.url || "").trim().slice(0, 300)};
    }).filter(function(it){ return it && url(it); });
  }
  // Fila de ícones clicáveis (opts.size, opts.names = mostra o nome ao lado).
  function rowHtml(list, opts){
    opts = opts || {};
    var items = clean(list); if (!items.length) return "";
    return '<div class="soc-row">' + items.map(function(it){
      var h = url(it), lb = label(it);
      return '<a class="soc-link" href="' + esc(h) + '" target="_blank" rel="noopener noreferrer" title="' + esc(lb) + '" aria-label="' + esc(lb) + '">' + icon(it.rede, opts.size) +
        (opts.names ? '<span class="soc-name">' + esc(lb) + '</span>' : '') + '</a>';
    }).join("") + '</div>';
  }
  // Texto simples (mensagens de WhatsApp/e-mail): "Instagram: https://…" por linha.
  function text(list){
    return clean(list).map(function(it){ return label(it) + ": " + url(it).replace(/^mailto:/, ""); }).join("\n");
  }
  var CSS = ".soc-row{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:center}" +
    ".soc-link{display:inline-flex;align-items:center;gap:6px;text-decoration:none;color:inherit;border-radius:50%;transition:transform .12s}" +
    ".soc-link:hover{transform:translateY(-2px)}.soc-link:focus-visible{outline:2px solid currentColor;outline-offset:2px}" +
    ".soc-ico{display:block;flex:none}.soc-name{font-size:12.5px;font-weight:600}";
  if (typeof document !== "undefined" && document.head && !document.getElementById("pipoRedesCss")){
    var st = document.createElement("style"); st.id = "pipoRedesCss"; st.textContent = CSS; document.head.appendChild(st);
  }
  window.PIPO_REDES = {list: LIST, get: get, icon: icon, url: url, label: label, clean: clean, rowHtml: rowHtml, text: text, css: CSS};
})();
