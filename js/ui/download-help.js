/**
 * Ajuda para fornecedores só com HTTP.
 *
 * Dentro da app (HTTPS) o browser bloqueia pedidos a servidores HTTP. Mas abrir
 * o endereço diretamente no Safari (navegação normal) é permitido: o utilizador
 * descarrega a lista, guarda-a em Ficheiros e importa-a como ficheiro.
 */
import { html, on } from '../core/dom.js';
import { getCredentials } from '../data/sources.js';
import { buildM3uDownloadUrl } from '../iptv/xtream-api.js';
import { icon } from './components/icons.js';
import { openSheet } from './components/overlay.js';
import { toast } from './components/toast.js';

/** Fontes para as quais esta ajuda se aplica. */
export const canOfferDownload = (source, code) =>
  source && source.type !== 'm3u-file' && ['mixed', 'network', 'cors', 'unreachable'].includes(code);

async function downloadUrlFor(source) {
  const c = await getCredentials(source);
  return source.type === 'xtream' ? buildM3uDownloadUrl(c.server, c.username, c.password) : c.url;
}

export async function openDownloadHelp(source) {
  let url;
  try {
    url = await downloadUrlFor(source);
  } catch (err) {
    toast(err.message, { type: 'error' });
    return;
  }

  openSheet({
    title: 'Obter a lista pelo Safari',
    content: html`
      <div class="prose">
        <p>O seu fornecedor usa HTTP e o iPhone não deixa a app contactá-lo diretamente. O Safari, porém, consegue abrir o endereço: descarrega a lista e depois importa-a como ficheiro.</p>
      </div>
      <ol class="steps steps--spaced">
        <li class="step"><span class="step__num">1</span><span>Toque em <b>Abrir no Safari</b>.</span></li>
        <li class="step"><span class="step__num">2</span><span>Se o Safari perguntar se quer <b>Transferir</b>, aceite: o ficheiro fica em <b>Ficheiros → Transferências</b>. Se aparecer uma página com texto a começar por <b>#EXTM3U</b>, toque em <b>Partilhar</b> ${icon('share', { size: 'sm' })} → <b>Guardar em Ficheiros</b>.</span></li>
        <li class="step"><span class="step__num">3</span><span>Volte à app: <b>Adicionar lista → Ficheiro</b> e escolha o ficheiro guardado.</span></li>
      </ol>
      <div class="form-actions">
        <a class="btn btn--primary btn--lg" data-download-link target="_blank" rel="noopener noreferrer">${icon('download', { size: 'sm' })}<span>Abrir no Safari</span></a>
        <button class="btn btn--secondary btn--lg" type="button" data-copy>Copiar endereço</button>
      </div>
      <div class="notice notice--warning notice--top">
        ${icon('shield', { size: 'sm' })}
        <div class="notice__body">O endereço contém o seu utilizador e password (é assim que o fornecedor funciona) e viaja sem cifra por HTTP. Não o partilhe com ninguém.</div>
      </div>
      <p class="field__hint sheet-note">Listas importadas por ficheiro não se atualizam sozinhas: repita estes passos quando o fornecedor alterar os canais. A reprodução de streams HTTP no iPhone será validada na Fase 4.</p>`,
    onMount(body) {
      // URL atribuído por propriedade (não fica no HTML do template) e só enquanto o painel está aberto.
      body.querySelector('[data-download-link]').href = url;
      const offCopy = on(body, 'click', '[data-copy]', async () => {
        try {
          await navigator.clipboard.writeText(url);
          toast('Endereço copiado. Cole-o na barra do Safari.', { type: 'success' });
        } catch {
          toast('Não foi possível copiar automaticamente.', { type: 'error' });
        }
      });
      return () => { offCopy(); url = null; };
    },
  });
}
