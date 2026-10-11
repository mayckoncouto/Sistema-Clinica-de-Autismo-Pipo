/* Service worker do sistema (app instalável).
 *
 * - Guarda no aparelho os arquivos do sistema (index.html, js/, ícones e a biblioteca do
 *   Supabase): o sistema abre na hora com a cópia guardada e, ao mesmo tempo, confere no
 *   servidor se há versão nova. Havendo, baixa a versão nova inteira (página + js/) e avisa
 *   a tela, que mostra "Nova versão disponível — Atualizar".
 * - NUNCA guarda dados: /api/, Supabase (banco, login, tempo real), página do link de
 *   cadastro (/c/, /cadastro) e a página de autorização (/oauth) passam direto.
 * - Notificações (push) ficam para uma etapa futura; os eventos "push" e
 *   "notificationclick" já estão prontos aqui.
 * Mudou a lista de arquivos do sistema? Acrescentar em SHELL e trocar VERSION.
 */
var VERSION = "pipo-v2";
var SHELL = ["/", "/js/redes.js", "/js/pipo-supabase.js", "/js/usuarios.js"];
var STATIC = ["/favicon.png", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png",
  "/icons/maskable-512.png", "/icons/apple-touch-icon.png"];
var CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    // Um arquivo que falhar não impede a instalação (fica para a próxima abertura).
    return Promise.all(SHELL.concat(STATIC, [CDN]).map(function (u) {
      return fetch(u, {cache: "no-cache"}).then(function (r) { if (r.ok) return c.put(u, r); }).catch(function () {});
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isShellNav(req, url) {
  return req.mode === "navigate" && (url.pathname === "/" || url.pathname === "/index.html" || url.pathname === "/index");
}

// A página mudou? Compara o texto da cópia guardada com o do servidor.
function sameBody(a, b) {
  if (!a) return Promise.resolve(false);
  return Promise.all([a.clone().text(), b.clone().text()]).then(function (t) { return t[0] === t[1]; });
}

var checking = null;
// Confere a página no servidor; se mudou, baixa página + js/ juntos e avisa as abas abertas.
function refreshShell() {
  if (checking) return checking;
  checking = caches.open(VERSION).then(function (c) {
    return c.match("/").then(function (old) {
      return fetch("/", {cache: "no-cache"}).then(function (fresh) {
        if (!fresh.ok || fresh.redirected) return;
        return sameBody(old, fresh).then(function (same) {
        if (same) return;
        return Promise.all(SHELL.slice(1).map(function (u) {
          return fetch(u, {cache: "no-cache"}).then(function (r) { return r.ok ? [u, r] : null; });
        })).then(function (js) {
          if (js.some(function (x) { return !x; })) return;   // não deixa página nova com js velho
          return Promise.all([c.put("/", fresh)].concat(js.map(function (x) { return c.put(x[0], x[1]); }))).then(function () {
            if (!old) return;
            return self.clients.matchAll({type: "window"}).then(function (list) {
              list.forEach(function (cl) { cl.postMessage({type: "pipo-update"}); });
            });
          });
        });
        });
      });
    });
  }).catch(function () {}).then(function () { checking = null; });
  return checking;
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);

  // Biblioteca do Supabase: cópia guardada na hora, atualizada por trás.
  if (url.href === CDN) {
    e.respondWith(caches.open(VERSION).then(function (c) {
      return c.match(CDN).then(function (hit) {
        var net = fetch(req).then(function (r) { if (r.ok) c.put(CDN, r.clone()); return r; });
        if (hit) { e.waitUntil(net.catch(function () {})); return hit; }
        return net;
      });
    }));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Página do sistema: abre a cópia guardada e confere a versão no servidor.
  if (isShellNav(req, url)) {
    e.respondWith(caches.match("/").then(function (hit) {
      if (hit) { e.waitUntil(refreshShell()); return hit; }
      return fetch(req).then(function (r) {
        if (r.ok) { var cp = r.clone(); caches.open(VERSION).then(function (c) { c.put("/", cp); }); }
        return r;
      });
    }));
    return;
  }
  // js/ do sistema: sempre a cópia que acompanha a página guardada (trocam juntos).
  if (SHELL.indexOf(url.pathname) > 0 || STATIC.indexOf(url.pathname) >= 0) {
    e.respondWith(caches.match(url.pathname).then(function (hit) {
      return hit || fetch(req).then(function (r) {
        if (r.ok) { var cp = r.clone(); caches.open(VERSION).then(function (c) { c.put(url.pathname, cp); }); }
        return r;
      });
    }));
  }
  // O resto (api/, link de cadastro, autorização…) não é tocado.
});

self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "pipo-check") e.waitUntil(refreshShell());
});

/* ---- Notificações (etapa futura) ---- */
self.addEventListener("push", function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = {body: e.data ? e.data.text() : ""}; }
  e.waitUntil(self.registration.showNotification(d.title || "Clínica de Autismo Pipo", {
    body: d.body || "", icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
    tag: d.tag || undefined, data: {url: d.url || "/"}
  }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || "/";
  e.waitUntil(self.clients.matchAll({type: "window", includeUncontrolled: true}).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if (new URL(list[i].url).origin === self.location.origin) { list[i].focus(); return list[i].navigate(target); }
    }
    return self.clients.openWindow(target);
  }));
});
