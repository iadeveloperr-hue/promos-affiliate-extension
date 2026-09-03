// Sincronização da Fila de Revisão entre perfis do Chrome via backend
// (Apps Script separado — ver lib/apps-script-queue.gs). Exposto como global.
//
// Modelo: o backend é a fila pendente compartilhada. Cada perfil mantém um
// conjunto local `syncKnownIds` (ids que já viu no backend) para convergir
// remoções: id conhecido que sumiu do backend = removido em outro perfil.
(function () {
  'use strict';

  const S = () => window.PromosStore;

  async function getUrl() {
    const { queueScriptUrl } = await chrome.storage.local.get('queueScriptUrl');
    return queueScriptUrl || '';
  }

  async function getKnownIds() {
    const obj = await chrome.storage.local.get('syncKnownIds');
    return new Set(obj.syncKnownIds || []);
  }
  async function setKnownIds(set) {
    await chrome.storage.local.set({ syncKnownIds: Array.from(set) });
  }

  // Prepara o candidato para viajar entre perfis:
  //  - blob:  → não portável (só vale na aba que capturou) → remove.
  //  - data:  → encolhe para uma miniatura que caiba numa célula da planilha
  //             (limite ~50k caracteres). A imagem cheia fica local; ao aprovar,
  //             a foto em alta é re-obtida da página do produto.
  //  - http(s) → portável, mantém como está.
  async function sanitize(c) {
    const copy = { ...c };
    const u = copy.imageUrl;
    if (typeof u === 'string') {
      if (/^blob:/.test(u))      copy.imageUrl = '';
      else if (/^data:/.test(u)) copy.imageUrl = await shrinkDataImage(u);
    }
    return copy;
  }

  // Redesenha um data: URL numa miniatura JPEG pequena. Retorna '' se falhar
  // ou se ainda passar do teto seguro de caracteres de uma célula.
  function shrinkDataImage(dataUrl, maxW = 200, quality = 0.6) {
    return new Promise(resolve => {
      try {
        const img = new Image();
        img.onload = () => {
          try {
            const scale = Math.min(1, maxW / img.naturalWidth);
            const w = Math.round(img.naturalWidth * scale);
            const h = Math.round(img.naturalHeight * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            const out = canvas.toDataURL('image/jpeg', quality);
            resolve(out.length <= 45000 ? out : '');
          } catch (_) { resolve(''); }
        };
        img.onerror = () => resolve('');
        img.src = dataUrl;
      } catch (_) { resolve(''); }
    });
  }

  async function remoteList(url) {
    const resp = await fetch(`${url}?action=queue_list`, { method: 'GET' });
    if (!resp.ok) throw new Error('queue_list HTTP ' + resp.status);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || 'queue_list erro');
    return Array.isArray(data.items) ? data.items : [];
  }

  async function post(url, payload) {
    try {
      const resp = await fetch(url, { method: 'POST', body: JSON.stringify(payload) });
      return resp.ok;
    } catch (_) {
      return false;
    }
  }

  window.PromosQueueSync = {
    async isEnabled() {
      return !!(await getUrl());
    },

    /**
     * Sincronização bidirecional:
     *   1. Empurra itens locais novos (não conhecidos e ausentes no backend).
     *   2. Puxa itens do backend ausentes localmente e não postados.
     *   3. Converge remoções: id conhecido sumido do backend → remove local.
     * Retorna { ok, pushed, pulled, removed, remote } ou { ok:false, reason }.
     */
    async sync() {
      const url = await getUrl();
      if (!url) return { ok: false, reason: 'sem URL' };
      const store = S();

      const items = await remoteList(url);
      const remoteById = new Map();
      for (const it of items) {
        const id = store.productId(it);
        if (id) remoteById.set(id, it);
      }

      const known   = await getKnownIds();
      const local   = await store.getQueue();
      const localIds = new Set(local.map(c => store.productId(c)).filter(Boolean));
      const history = await store.get('postedHistory', {});

      let pushed = 0, pulled = 0, removed = 0;

      // 1. PUSH — itens locais que nunca compartilhamos
      for (const c of local) {
        const id = store.productId(c);
        if (!id || remoteById.has(id) || known.has(id)) continue;
        if (await post(url, { action: 'queue_add', id, candidate: await sanitize(c) })) {
          remoteById.set(id, c);
          known.add(id);
          pushed++;
        }
      }

      // 2. PULL — itens do backend ausentes localmente e não postados
      for (const [id, it] of remoteById) {
        if (localIds.has(id) || id in history) { known.add(id); continue; }
        if (await store.enqueue(it)) pulled++;
        known.add(id);
      }

      // 3. REMOVE — id conhecido que sumiu do backend = removido em outro perfil
      for (const id of Array.from(known)) {
        if (remoteById.has(id)) continue;
        const cand = local.find(c => store.productId(c) === id);
        if (cand) { await store.dequeue(cand); removed++; }
        known.delete(id);
      }

      await setKnownIds(known);
      return { ok: true, pushed, pulled, removed, remote: remoteById.size };
    },

    /** Remove um candidato do backend (ao aprovar/descartar). */
    async remove(candidate) {
      const url = await getUrl();
      if (!url) return;
      const id = S().productId(candidate);
      if (!id) return;
      await post(url, { action: 'queue_remove', id });
      const known = await getKnownIds();
      known.delete(id);
      await setKnownIds(known);
    },

    /** Esvazia a fila compartilhada (e o conjunto local de ids conhecidos). */
    async clearRemote() {
      const url = await getUrl();
      if (!url) return;
      await post(url, { action: 'queue_clear' });
      await setKnownIds(new Set());
    },
  };
})();
