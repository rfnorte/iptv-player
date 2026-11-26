/** Páginas de detalhe: filme e série (temporadas e episódios). */
import { html, render, on, vars } from '../../core/dom.js';
import { formatDuration } from '../../core/format.js';
import { catalog } from '../../data/catalog.js';
import { favorites } from '../../data/favorites.js';
import { screenHeader, mountHeader } from '../components/header.js';
import { artBlock, emptyState } from '../components/cards.js';
import { chips, setChips } from '../components/controls.js';
import { icon } from '../components/icons.js';
import { bindCommonActions } from '../shared.js';
import { openPlayer } from '../../player/player.js';
import { canPlay } from '../../player/stream-source.js';
import { safeUrl } from '../../core/dom.js';

function notFound(ctx, fallback, label) {
  render(ctx.outlet, html`
    ${screenHeader({ title: '', large: false, back: { fallback } })}
    ${emptyState({ iconName: 'alert', title: `${label} não encontrado`, text: 'O conteúdo pode ter sido removido ao atualizar a lista.',
      actions: html`<a class="btn btn--secondary btn--block" href="#${fallback}">Voltar à biblioteca</a>` })}`);
  return bindCommonActions(ctx.outlet, ctx);
}

function hero(item) {
  return html`
    <div class="detail-hero bleed" data-header-sentinel>
      ${artBlock(item, { className: 'detail-hero__backdrop', label: false })}
      <div class="detail-hero__content">
        ${artBlock(item, { className: 'detail-hero__poster' })}
        <div class="detail-hero__text">
          <h1 class="detail-hero__title">${item.name}</h1>
          <p class="detail-hero__meta" data-meta></p>
        </div>
      </div>
    </div>`;
}

function actions(kind, item, { resumeLabel, playable }) {
  const isFav = favorites.has(kind, item.id);
  return html`
    <div class="detail-actions">
      <button class="btn btn--primary btn--lg" type="button" data-action="play" ${playable ? '' : html`disabled aria-describedby="detail-play-note"`}>
        ${icon('play', { size: 'sm' })}<span>${resumeLabel ?? 'Reproduzir'}</span>
      </button>
      <button class="btn btn--secondary btn--lg" type="button" data-action="toggle-fav" data-kind="${kind}" data-id="${item.id}"
        aria-pressed="${isFav ? 'true' : 'false'}" aria-label="${isFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}: ${item.name}">
        ${icon(isFav ? 'heartFill' : 'heart', { size: 'sm' })}<span data-fav-label>${isFav ? 'Nos favoritos' : 'Favorito'}</span>
      </button>
    </div>
    ${playable ? '' : html`<p class="field__hint" id="detail-play-note">Conteúdo de demonstração: não tem vídeo associado.</p>`}`;
}

function metaText(parts) {
  return parts.filter(Boolean).join(' · ');
}

/* ---------------- Filme ---------------- */
async function renderMovie(ctx) {
  const { outlet } = ctx;
  render(outlet, html`<div class="detail-skeleton skeleton bleed"></div>`);
  const movie = await catalog.movie(ctx.params.id);
  if (!ctx.isActive()) return;
  if (!movie) return notFound(ctx, '/movies', 'Filme');

  const percent = movie.progress?.percent;
  render(outlet, html`
    ${screenHeader({ title: movie.name, large: false, back: { fallback: '/movies', label: 'Voltar aos filmes' } })}
    ${hero(movie)}
    <div class="detail-body stack stack--sm">
      ${movie.rating || movie.genres?.length ? html`<div class="detail-badges">${movie.rating ? html`<span class="badge badge--neutral">★ ${Number(movie.rating).toFixed(1)}</span>` : ''}${(movie.genres ?? []).filter(Boolean).map((g) => html`<span class="badge badge--accent">${g}</span>`)}</div>` : ''}
      ${Number.isFinite(percent) ? html`
        <div class="detail-progress">
          <span class="progress" data-vars="${vars({ progress: percent })}"></span>
          <span class="text-tertiary">${percent}% visto · ${formatDuration(movie.durationMin * (1 - percent / 100))} restantes</span>
        </div>` : ''}
      ${actions('movie', movie, { resumeLabel: Number.isFinite(percent) ? 'Continuar' : null, playable: canPlay(movie.play) })}
      ${movie.description ? html`<p class="detail-description">${movie.description}</p>` : ''}
    </div>`);
  outlet.querySelector('[data-meta]').textContent = metaText([movie.year, formatDuration(movie.durationMin), movie.genres?.[0]]);

  const offs = [
    bindCommonActions(outlet, ctx),
    mountHeader(outlet),
    on(outlet, 'click', '[data-action="play"]', () => openPlayer({
      title: movie.name,
      subtitle: metaText([movie.year, movie.genres?.[0]]),
      play: movie.play,
      isLive: false,
      artwork: safeUrl(movie.poster),
      description: movie.description,
    })),
  ];
  return () => offs.forEach((off) => off());
}

/* ---------------- Série ---------------- */
function episodeList(seasonData, lastWatched) {
  return html`
    <ol class="episodes" aria-label="Episódios da temporada ${seasonData.number}">
      ${seasonData.episodes.map((ep) => {
        const isLast = lastWatched && lastWatched.season === ep.season && lastWatched.episode === ep.episode;
        const inner = html`
            <span class="episode__num">${ep.episode}</span>
            <span class="episode__body">
              <span class="episode__title truncate">${ep.name}</span>
              <span class="episode__meta">${formatDuration(ep.durationMin)}${isLast ? html` · <b class="episode__flag">Último visto</b>` : ''}</span>
              ${isLast ? html`<span class="progress" data-vars="${vars({ progress: lastWatched.percent })}"></span>` : ''}
            </span>`;
        return canPlay(ep.play)
          ? html`<li><button class="episode episode--playable ${isLast ? 'episode--last' : ''}" type="button" data-action="play-episode" data-season="${ep.season}" data-episode="${ep.episode}" aria-label="Reproduzir episódio ${ep.episode}: ${ep.name}">${inner}<span class="episode__play">${icon('play', { size: 'sm' })}</span></button></li>`
          : html`<li class="episode ${isLast ? 'episode--last' : ''}">${inner}</li>`;
      })}
    </ol>`;
}

async function renderSeries(ctx) {
  const { outlet } = ctx;
  render(outlet, html`<div class="detail-skeleton skeleton bleed"></div>`);
  const series = await catalog.series(ctx.params.id);
  if (!ctx.isActive()) return;
  if (!series) return notFound(ctx, '/series', 'Série');

  const requested = Number(ctx.query.season);
  let season = series.seasons.some((s) => s.number === requested) ? requested
    : series.lastWatched?.season ?? series.seasons[0]?.number;
  const lw = series.lastWatched;
  const lastEp = lw ? series.seasons.find((s) => s.number === lw.season)?.episodes.find((e) => e.episode === lw.episode) : null;

  render(outlet, html`
    ${screenHeader({ title: series.name, large: false, back: { fallback: '/series', label: 'Voltar às séries' } })}
    ${hero(series)}
    <div class="detail-body stack stack--sm">
      ${lastEp ? html`
        <div class="notice">
          ${icon('history', { size: 'sm' })}
          <div class="notice__body"><div class="notice__title">Último episódio visto</div>T${lw.season} · E${lw.episode} — ${lastEp.name} (${lw.percent}%)</div>
        </div>` : ''}
      ${actions('series', series, { resumeLabel: lastEp ? `Continuar T${lw.season}·E${lw.episode}` : null, playable: series.seasons.some((s) => s.episodes.some((e) => canPlay(e.play))) })}
      ${series.description ? html`<p class="detail-description">${series.description}</p>` : ''}
      <section>
        <h2 class="section-header__title">Episódios</h2>
        ${series.seasons.length > 1 ? chips('season', series.seasons.map((s) => ({ value: String(s.number), label: `Temporada ${s.number}`, count: s.episodes.length })), String(season), { label: 'Temporadas' }) : ''}
        <div data-episodes></div>
      </section>
    </div>`);
  outlet.querySelector('[data-meta]').textContent = metaText([
    series.year,
    series.seasons.length ? `${series.seasons.length} ${series.seasons.length === 1 ? 'temporada' : 'temporadas'}` : null,
    series.genres?.[0],
  ]);

  const playEpisode = (seasonNo, episodeNo) => {
    const ep = series.seasons.find((s) => s.number === seasonNo)?.episodes.find((x) => x.episode === episodeNo);
    if (!ep || !canPlay(ep.play)) return;
    openPlayer({
      title: `${series.name}`,
      subtitle: `T${ep.season} · E${ep.episode} — ${ep.name}`,
      play: ep.play,
      isLive: false,
      artwork: safeUrl(series.poster),
      description: series.description,
    });
  };

  const epEl = outlet.querySelector('[data-episodes]');
  const showSeason = () => {
    const data = series.seasons.find((s) => s.number === season);
    if (data) { render(epEl, episodeList(data, lw)); return; }
    render(epEl, emptyState({
      compact: true,
      iconName: series.episodesError ? 'alert' : 'series',
      title: series.episodesError ? 'Não foi possível obter os episódios' : 'Sem episódios',
      text: series.episodesError ?? 'Esta série não tem episódios disponíveis na lista.',
      actions: series.episodesError ? html`<button class="btn btn--secondary btn--block" type="button" data-action="retry-episodes">Tentar novamente</button>` : null,
    }));
  };
  showSeason();

  const offs = [
    bindCommonActions(outlet, ctx),
    mountHeader(outlet),
    on(outlet, 'click', '[data-action="retry-episodes"]', () => ctx.router.refresh()),
    on(outlet, 'click', '[data-action="play-episode"]', (e, b) => playEpisode(Number(b.dataset.season), Number(b.dataset.episode))),
    on(outlet, 'click', '[data-action="play"]', () => {
      const target = lw ?? { season: series.seasons[0]?.number, episode: series.seasons[0]?.episodes[0]?.episode };
      playEpisode(target.season, target.episode);
    }),
    on(outlet, 'click', '[data-chip="season"]', (e, b) => {
      season = Number(b.dataset.value);
      setChips(outlet, 'season', b.dataset.value);
      history.replaceState(null, '', `#/series/${encodeURIComponent(series.id)}?season=${season}`);
      showSeason();
    }),
  ];
  return () => offs.forEach((off) => off());
}

export const movieDetailScreen = { render: renderMovie };
export const seriesDetailScreen = { render: renderSeries };
