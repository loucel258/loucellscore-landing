# Rediseño del home — "Turno de noche" (2026-09-30)

Rama: `rediseno-home` (sin commit, sin push). Alcance: `/en` y `/es`.
Las subpáginas (`/services/*`, `/privacy`, `/terms`) no cambian: siguen
con el sistema slate/cyan y sus propios Nav/Footer/CTA.

---

## 1. Auditoría del sitio actual (loucellscore.com, medido 2026-09-30)

### Bugs y problemas medibles

| # | Hallazgo | Evidencia | Estado en el rediseño |
|---|---|---|---|
| 1 | Scroll horizontal en desktop: la página mide 1613 px en un viewport de 1440 | Playwright, `scrollWidth > innerWidth` | Resuelto: 0 overflow en 1440 y 390 |
| 2 | Stat inventado: "1,247 audit rows this week" hardcodeado en `architecture.tsx` | Número fijo en código, sin fuente | Eliminado. El audit log del home ahora calcula SHA-256 reales en el navegador |
| 3 | FAQ con dos preguntas de precio duplicadas (#1 y #7) | `dict.faq` | Fusionadas; quedan 8 preguntas |
| 4 | Pasos de "How we work" ilegibles hasta scrollear (opacidad 0.35) | Captura full-page | Pasos siempre legibles; el scroll solo marca progreso |
| 5 | Sin menú en móvil: los links del nav desaparecen bajo `md` | `nav.tsx` | Menú móvil a pantalla completa |
| 6 | Columnas vacías grandes en Governance y en el CTA final (imagen enmascarada casi invisible) | Capturas desktop | Nuevas composiciones sin huecos |
| 7 | Link muerto en el footer: `#enterprise` (la tarjeta está oculta desde el pivot) | `footer.tsx` | Footer nuevo con links reales |
| 8 | Se carga Geist pero se renderiza Inter (+ JetBrains Mono): doble payload de fuentes, y el brand dice Geist | `layout.tsx` vs `globals.css` | Home usa Geist + Geist Mono + Instrument Serif (100 KB de fuentes vs 212 KB) |
| 9 | 14 secciones, ~11 000 px en desktop y ~17 000 px en móvil, 5 CTAs compitiendo | Capturas | 8 secciones; un CTA primario (llamada vía chat), uno secundario (mensaje), uno terciario (checklist) |
| 10 | Em dashes en casi todo el copy, contra `brand-profile.json` | `en.ts`, `es.ts` | Copy nuevo sin em dashes |
| 11 | LCP 4.25 s desktop / 2.84 s móvil | PerformanceObserver, sitio en vivo | Build local: LCP ~1.9 s, CLS 0 (local vs remoto no es 1:1; re-medir en preview de Vercel) |
| 12 | `<html lang="en">` fijo también en `/es` | `app/layout.tsx` | Parcial: el wrapper del home lleva `lang={locale}`. Arreglo completo requiere mover `<html>` al layout de locale (toca admin/portal) |

### Problemas de estrategia y diseño

- **Mismo lenguaje visual que cualquier agencia de IA**: navy + glows cyan/violeta + racimos de nodos 3D. El brand profile lista "AI brain illustrations" y "blue gradient blobs" como anti-referencias, y el hero actual es exactamente eso.
- **Tarjetas en grillas idénticas** (templates 6×, why-us 4×, pillars 3×): el anti-patrón que `PRODUCT.md` nombra.
- **La propuesta de valor es abstracta** ("Governed AI. No Experiments.") para un dueño de negocio de servicios que piensa en "¿quién contesta a las 9 PM?".
- **El control (el diferenciador real) se afirma, no se muestra**: listas de capas y pilares, pero nada que el visitante pueda tocar.
- **Local, no se reprodujo en prod**: `.env.local` tiene `NEXT_PUBLIC_SITE_URL=https://loucellabs.com` y `NEXT_PUBLIC_CONTACT_EMAIL=hello@loucellabs.com` (marca vieja). Producción muestra `contact@loucellscore.com`, pero conviene limpiar el `.env.local`.
- El widget de chat responde 403 en `localhost` (slug `loucels-landing-dev` sin `localhost` en el allowlist): no se pueden probar los CTAs de punta a punta en local.

---

## 2. Concepto: una noche, de 9:47 PM a 7:02 AM

El sitio cuenta la promesa en vez de describirla. Abre en la encimera oscura
de una casa del sur de Florida: un teléfono y las llaves de la camioneta.
Llega un mensaje. Al scrollear, la noche pasa en time-lapse hasta el
amanecer mientras el log de la noche se escribe solo, y termina con el
reporte de la mañana que el visitante puede aprobar.

Las llaves son el hilo: "We run the agent. You hold the keys."

### Sistema visual (solo home, scope `.lc-home` en `globals.css`)

| Token | Valor | Uso |
|---|---|---|
| paper | `#f2eee6` | fondo de día |
| ink | `#17140f` | texto (15.9:1 sobre paper) |
| night | `#0b0d11` | hero, CTA final, footer |
| bone | `#eee8dd` | texto sobre noche (16:1) |
| dawn | `#e4773a` | único acento: CTAs (texto ink encima, 6.1:1) |
| dawn-deep | `#a4460f` | acento como texto sobre paper (5.2:1) |
| live | `#62d6c9` | solo el punto de "agente activo" |

Tipografía: Instrument Serif (display, self-hosted por `next/font`), Geist
(texto), Geist Mono (horas, hashes, labels). Nada de glows, gradientes en
titulares ni tarjetas en grilla.

**Nota:** esto se aparta de `brand-profile.json` (paleta slate/cyan/violeta,
headings en Geist). Si el rediseño se aprueba, hay que actualizar el brand
profile; si no, los tokens viven en un solo bloque y se pueden cambiar.

---

## 3. Estructura nueva (14 → 8 secciones)

1. **Una noche** (`night-hero.tsx`): pinned 460vh. Video de entrada (el
   teléfono se enciende, notificación anclada sobre la pantalla), luego
   scrub de 96 frames noche → amanecer, reloj 9:47 PM → 7:02 AM, log de la
   noche, y reporte de la mañana con Aprobar/Rechazar. Etiquetado "Noche
   simulada · flujo real del producto".
2. **La fuga** (`leak-math.tsx`): calculadora con los números del
   visitante (consultas × 4.33 × valor × cierre). Sin benchmarks.
3. **Qué opera** (`departments.tsx`): tabs accesibles (flechas) con demo
   viva por departamento: SMS con toggle ES/EN, cotización que se aprueba,
   respuesta a reseña que se aprueba. Chips por oficio abren el chat con
   el prompt de la plantilla.
4. **Control** (`control-room.tsx`): panel del dueño (pausar agente,
   "pregúntame antes de", revocar keys). Cada cambio se agrega a un audit
   log cuyo hash SHA-256 encadena la fila anterior. Foto macro de las
   llaves con parallax, 7 capas del Trust Stack que se iluminan con el
   scroll, lista de herramientas.
5. **Cómo empezar** (`how-it-starts.tsx`): 4 pasos con progreso ligado al
   scroll, tarjeta de Gap Audit, 4 estándares (incluye el día 90).
6. **Preguntas** (`home-faq.tsx`): 8 preguntas, FAQ schema intacto.
7. **Esta noche a las 9:47** (`tonight.tsx`): hora azul, CTA final;
   formulario de mensaje y checklist con los mismos endpoints y payloads
   que antes (`/api/contact` con honeypot, `/api/subscribe`, source
   `home_checklist`).
8. **Footer** (`home-footer.tsx`).

Copy bilingüe en `src/components/home/copy.ts` (no toca el `Dictionary`
compartido).

### Reglas de honestidad aplicadas

- Todo lo que parece producto en vivo dice "simulado".
- Sin precios de Loucells (la cotización de ejemplo es de un cliente ficticio de techos, etiquetada).
- La calculadora solo multiplica los inputs del visitante.
- El "día 90" usa la misma promesa que ya está publicada.

---

## 4. Media generada (Replicate)

| Pieza | Modelo | Notas |
|---|---|---|
| 8 stills 2K (noche, oscuro, amanecer, hora azul; 16:9 y 9:16) | google/nano-banana-pro | La noche es el original; las demás son ediciones que preservan composición |
| Macro de llaves 4:5 | google/nano-banana-pro | Referencia: el still del amanecer |
| Clip de entrada (5 s) y scrub (8 s), desktop y móvil | bytedance/seedance-2.5 | Modo first/last frame, 720p, sin audio, cámara fija |
| Upscale a 1080p | topazlabs/video-upscale | Comparado al 100% contra lanczos local: Topaz sin halos |

Costo aproximado: Seedance 26 s ≈ $6.01, 9 imágenes ≈ $1.35, Topaz ≈ $0.80.
**Total ≈ $8.2.**

Masters, prompts con seeds, IDs de predicción y log de llamadas:
`nexusia/media/home-night-shift-2026-09-30/` (fuera del repo, 69 MB).

Assets web en `public/home/`: `desk/` y `mob/` con `entry.mp4` (~800 KB),
`f/000-095.webp` (3.7 MB por orientación), stills `dark/night/morning.webp`;
`dusk.jpg`, `keys.jpg`.

Carga: 8 frames al inicio y el resto al primer scroll o tras 4 s de
inactividad (Save-Data: la mitad de frames). Primer load medido: 1.65 MB
(de ellos 780 KB son el video de entrada).

---

## 5. Verificación

- `tsc --noEmit`: limpio. `eslint src/components/home`: limpio (el código
  existente tiene 20 errores previos, no tocados).
- `next build`: OK; `/en` y `/es` prerenderizados estáticos.
- Playwright (desktop 1440×900 y móvil 390×844, EN y ES): 19/19 pruebas de
  interacción pasan (video, scrub, aprobar, sliders, 3 demos, teclado en
  tabs, chips → chat, panel → log encadenado, FAQ, validación de form,
  menú móvil, reduced-motion sin video ni pin).
- Subpáginas `/en/services/ai-departments` y
  `/es/services/operations-gap-audit`: 200, sin cambios visuales, sin errores.

## 6. Pendientes / decisiones para Steven

1. Revisar en un preview de Vercel (medir LCP real en móvil con red).
2. ¿Migrar las subpáginas al sistema nuevo? Hoy el salto home → subpágina cambia de estética.
3. Componentes que el home ya no usa (no borrados): `sections/hero`, `logos-marquee`, `sms-demo`, `manifesto`, `offer`, `templates`, `why-us`, `process`, `architecture`, `faq`, `contact-form`, `trust-stack-pdf-cta`, `trust-stack-flow`, `scroll-progress`, `hero/cluster-3d`, `hero/pseudo-3d-hero`, y `public/hero/*`, `public/scroll-frames/*`. `nav`, `sections/footer` y `sections/cta` siguen en uso por las subpáginas.
4. OG image (`opengraph-image.tsx`) sigue con la marca anterior; se puede rehacer con el still de la noche.
5. Actualizar `brand-profile.json` si se aprueba la paleta nueva.
6. Limpiar `.env.local` (dominio y email de la marca vieja).

---

## 7. Segunda etapa (30 sep): subpáginas y revisión de copy

Steven aprobó el concepto y pidió llevarlo a las subpáginas, no ser tan
explícitos con el "se paga solo en 90 días" y revisar que los textos no
parezcan hechos con IA.

### Subpáginas migradas al sistema nuevo
- Shell compartido `src/components/site/site-shell.tsx` (tokens, nav, footer).
  El nav usa rutas absolutas (`/es#control`, `/es/services`) y el cambio de
  idioma conserva la página actual.
- Bloques en `src/components/site/blocks.tsx`: hero nocturno con foto,
  secciones en papel con listas de reglas (no grillas de tarjetas), filas de
  servicios con enlace, pasos con progreso por scroll, checklist, datos clave.
- Páginas de línea (`line-page.tsx`): AI Departments incluye la demo de los
  tres agentes; Integration & Control incluye el panel del dueño con el
  audit log.
- `/services`: índice por línea, cada servicio enlaza a su ficha.
- Fichas (`/services/[slug]`): hero, resumen con tiempo y precio ("fijo,
  se define después de la llamada"), para quién es, qué incluye, lo que
  viene de serie, CTA de la hora azul.
- Gap Audit: se conserva la vitrina (tres lentes, 7 días, dos documentos,
  crédito del 50%), reestilizada; los hallazgos se marcan "de ejemplo".
- Legales y 404 dentro del mismo sistema.
- Ya no se usan (no se borraron): `nav.tsx`, `sections/footer.tsx`,
  `sections/cta.tsx`, `sections/subpage/*`, `scroll-progress.tsx`,
  `hero/cluster-3d.tsx` y las imágenes de `public/hero/`.

### Promesa de 90 días
Se quitó en todo el sitio. En su lugar: "Medido desde el inicio": al
empezar se anotan los números de partida y el portal muestra cada semana
clientes atendidos y trabajos agendados (lo que `lib/portal/roi.ts` mide
hoy). La FAQ "¿Cuándo se paga solo?" pasó a "¿Cómo sé si está
funcionando?", sin fecha prometida. También se neutralizó en el diccionario
viejo.

### Revisión de copy (home, páginas de línea, 11 fichas, Gap Audit)
- Fuera: em dashes, antítesis tipo "no X, sino Y", remates ingeniosos
  ("falla en voz alta"), eslóganes en tríada (salvo "Answered. Booked.
  Logged.", que es la línea de marca), jerga ("moat", "heads-down",
  "The Arsenal", "We maintain the shield").
- Español neutro: fuera el voseo de las fichas ("Sabé", "rankeás") y
  anglicismos innecesarios ("build" → proyecto, "discovery" → llamada
  gratis, "retainer" → pago mensual).
- Inconsistencias corregidas: Review Manager y Quote Accelerator ahora
  dicen en todas partes que las respuestas y cotizaciones esperan tu
  aprobación (las fichas decían que se publicaban solas).
- **Ojo:** el agente del chat en producción lee `src/lib/services-data.ts`
  como catálogo. Al desplegar, el chat describirá los servicios con el
  texto nuevo. Los `priceLabel` no se tocaron.

### Verificación
- 16 rutas × desktop y móvil: todas 200 (404 donde corresponde), sin
  scroll horizontal, sin errores de página. Los únicos errores de consola
  en local son los scripts de Vercel Analytics, que solo existen en Vercel.
- 23/23 pruebas de interacción (las 19 del home más locale toggle en
  subpágina, navegación a secciones del home, lentes de la Gap Audit y
  enlaces del índice).
- `tsc`, `eslint` (archivos nuevos) y `next build`: OK.
