/* ══ SERVICE WORKER — ECC / 13e CBFC Kingasani 2 ═══════════════════════════
 *
 * Ce fichier sert une seule chose : que l'application s'ouvre quand le réseau
 * est mauvais ou absent. Les DONNÉES, elles, ne passent pas par ici — c'est
 * Firestore qui gère son propre hors-ligne (enablePersistence), et intercepter
 * ses requêtes casserait la synchronisation.
 *
 * Trois règles, dans cet ordre :
 *
 *  1. On ne touche QU'À UNE LISTE BLANCHE d'hôtes (ce site, les librairies
 *     gstatic / cdnjs, les polices Google). Tout le reste — firestore,
 *     identitytoolkit, securetoken, storage — n'est même pas regardé.
 *     Liste blanche et non liste noire : un hôte Google oublié casserait la
 *     base, alors qu'une librairie oubliée ne coûte qu'un aller au réseau.
 *
 *  2. La PAGE (index.html) est servie RÉSEAU D'ABORD. C'est le point
 *     essentiel : une correction publiée doit arriver chez tout le monde. Le
 *     cache n'est qu'un filet quand le réseau ne répond pas en 5 secondes.
 *
 *  3. Les LIBRAIRIES sont servies CACHE D'ABORD : leurs URL portent leur
 *     version (firebasejs/10.12.0, xlsx/0.18.5), elles ne changent jamais.
 *     C'est ce qui permet d'ouvrir l'application sans réseau du tout.
 *
 * ⚠ VERSION : à remonter en même temps que APP_VERSION dans index.html.
 *   Elle nomme le cache ; la changer purge l'ancien au prochain démarrage.
 */

var VERSION = "2026.10.3";
var CACHE   = "ecc-kingasani2-" + VERSION;

// Le strict nécessaire pour afficher l'écran de connexion sans réseau.
var COQUILLE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icones/icon-192.png",
  "./icones/icon-512.png",
  "./icones/icon-maskable-512.png",
  "./icones/apple-touch-icon.png",
  "./icones/favicon-32.png"
];

// Hôtes dont on a le droit de garder une copie. Rien d'autre n'est intercepté.
var HOTES_CACHABLES = [
  "www.gstatic.com",          // SDK Firebase (URL versionnée)
  "cdnjs.cloudflare.com",     // SheetJS (URL versionnée)
  "fonts.googleapis.com",     // feuille de style des polices
  "fonts.gstatic.com"         // fichiers de polices
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // addAll échoue en bloc si un seul fichier manque : on ajoute un par un
      // pour qu'un oubli ne prive pas l'application de tout son cache.
      return Promise.all(COQUILLE.map(function (u) {
        return c.add(new Request(u, { cache: "reload" })).catch(function () {});
      }));
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (noms) {
      return Promise.all(noms.map(function (n) {
        if (n !== CACHE && n.indexOf("ecc-kingasani2-") === 0) return caches.delete(n);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// L'application demande explicitement la bascule quand l'utilisateur clique
// « Actualiser » : on ne prend jamais la main sur une page en cours de saisie.
self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

function cachable(url) {
  if (url.origin === self.location.origin) return true;
  return HOTES_CACHABLES.indexOf(url.hostname) >= 0;
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;                 // écritures : jamais
  if (req.headers.has("range")) return;             // téléchargements partiels
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (!cachable(url)) return;                       // Firestore, Auth, Storage…

  // ── La page : réseau d'abord, cache en filet ──────────────────────────
  if (req.mode === "navigate") {
    e.respondWith(reseauDAbord(req));
    return;
  }

  // ── Librairies et icônes : cache d'abord, réseau sinon ────────────────
  e.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (rep) {
        if (rep && rep.ok && (rep.type === "basic" || rep.type === "cors")) {
          var copie = rep.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copie); });
        }
        return rep;
      });
    })
  );
});

function reseauDAbord(req) {
  return new Promise(function (resolve) {
    var repondu = false;
    function repondre(r) { if (!repondu) { repondu = true; resolve(r); } }

    // « no-cache » et non un fetch ordinaire : sans cela le cache HTTP du
    // navigateur rend l'ancienne page sans rien demander au serveur, et une
    // correction publiée n'arrive jamais. Avec revalidation, le serveur
    // répond 304 quand rien n'a changé — le coût est nul — et 200 avec la
    // nouvelle page sinon.
    //
    // Le réseau met à jour le cache même s'il arrive après le délai : la
    // prochaine ouverture hors ligne servira alors la version récente.
    fetch(new Request(req.url, { cache: "no-cache", credentials: "same-origin" })).then(function (rep) {
      if (rep && rep.ok) {
        var copie = rep.clone();
        caches.open(CACHE).then(function (c) {
          c.put("./index.html", copie.clone());
          c.put("./", copie);
        });
      }
      repondre(rep);
    }).catch(function () {
      caches.match("./index.html").then(function (hit) {
        repondre(hit || new Response(
          "<!doctype html><meta charset=utf-8><title>Hors ligne</title>"
          + "<body style='font-family:system-ui;background:#002F6B;color:#fff;"
          + "display:flex;align-items:center;justify-content:center;height:100vh;"
          + "margin:0;text-align:center;padding:24px'><div><h1 style='font-size:1.1rem'>"
          + "Application non encore mise en cache</h1><p style='opacity:.8;font-size:.9rem'>"
          + "Ouvrez-la une fois avec du réseau, puis elle fonctionnera hors ligne.</p></div>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } }
        ));
      });
    });

    setTimeout(function () {
      if (repondu) return;
      caches.match("./index.html").then(function (hit) { if (hit) repondre(hit); });
    }, 5000);
  });
}
