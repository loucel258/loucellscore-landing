# Revisión de admin, portal y agentes (30 sep - 1 oct 2026)

Rama: `rediseno-home` (sin commit, sin push, sin migraciones aplicadas).
Método: tres revisiones de solo lectura (portal, admin, runtime de agentes) y
después tres agentes implementando en paralelo, cada uno dueño de sus archivos.
Cada hallazgo se verificó leyendo el código antes de tocarlo.

---

## 1. Lo que está roto en producción hoy

Estos problemas están en vivo en www.loucellscore.com. El arreglo está en la
rama, pero no llega a producción hasta que se despliegue.

| # | Problema | Quién lo nota | Arreglo en la rama | Mitigación sin deploy |
|---|---|---|---|---|
| 1 | El chat web de `naile-assistant` tiene `request_booking`: si un cliente de Denise pide cita, recibe el link a **tu** Cal.com (`cal.com/loucellscore/30min`) con su nombre y motivo en la URL | Clientes de Denise | El link sale de la config de cada agente; sin link configurado, la herramienta no se ofrece | Quitar `request_booking` de `tools_enabled` de `naile-assistant` (1 fila, reversible) |
| 2 | Login del admin acepta `?next=` sin validar: un link armado con `javascript:` ejecuta código con tu sesión recién abierta (por ejemplo, rotar el passcode de un cliente y mandarlo afuera) | Tú, si abres un link malicioso | Solo se aceptan rutas `/admin/...` | No abrir links de login que no escribiste tú |
| 3 | Recordatorios: si falla la lectura de credenciales de Naile, el cron cae al camino de Google Calendar, que no revisa STOP ni consentimiento | Clientes que mandaron STOP | Un único punto de envío proactivo que revisa opt-out, consentimiento y horario | Ninguna sin deploy |
| 4 | El barrido de aprobaciones colgadas (`/api/admin/hitl/sweep`) no está programado en ningún lado | Aprobaciones que quedan en `approving` para siempre | Validación del parámetro; la programación queda como decisión (sección 4) | Llamarlo a mano con el secreto |
| 5 | `chat-health-alerts` dice "cada 15 minutos" pero `vercel.json` lo corre una vez al día: la regla "chat caído en los últimos 15 min" está ciega ~23h45m al día | Tú (no te enteras si el chat se cae) | Decisión de scheduler (sección 4) | Ninguna |

Además, los 6 bloqueos de salida a producción del SMS conversacional
(revisión del 22 jun) siguen abiertos. El SMS no está enviando todavía porque
falta el 10DLC de Denise, así que hoy no hay daño, pero no se puede prender
hasta cerrarlos (ver sección 3, agentes).

---

## 2. Hecho en la rama

### Admin (15 arreglos)

- **Login seguro**: `?next=` solo acepta rutas `/admin/...` (helper `lib/admin/safe-next.ts` con tests). Al entrar ya logueado va a `/admin/dashboard`.
- **Rotar passcode del portal**: se hace por engagement, nunca reactiva un portal revocado, pide dos toques y queda en auditoría. Antes podía rotar (y reactivar) el portal de otro cliente si los slugs coincidían.
- **Slug bloqueado** fuera de `designing` (cambiarlo rompía el widget del cliente). Slug duplicado devuelve `slug_taken` en vez del error crudo de Postgres.
- **Crear engagement**: busca la cuenta por email exacto (antes `ilike`, donde `_` y `%` eran comodines) y no crea un engagement sin cuenta.
- **Métricas limpias**: tus propias acciones (`admin`, `portal:*`, `front_desk*`, `system:*`) ya no cuentan como conversaciones del cliente ni le quitan la alerta de "cuenta callada".
- **Engagement con varios agentes**: aprobaciones, conversaciones, auditoría y costos ahora suman todos los agentes, no solo el primero.
- **Leads**: el dashboard y chat-pulse muestran solo tus leads (antes mezclaban los clientes de tus clientes).
- **Ingresos y Clientes**: nombres reales en "Top clients" y la columna Retainer ya no sale vacía.
- **Bloque de cobro** en la config del agente: $/mes, activo (con fechas automáticas) y minutos ahorrados por conversación. Antes solo se podía por SQL.
- **Botones muertos** ("v1.1") reemplazados por texto claro; el tile de aprobaciones lleva a la pestaña correcta.
- **Doble toque** para Pausar, Archivar, rotar passcode y correr un cron.
- **CRM**: los errores se muestran y el selector de etapa vuelve atrás si falla.
- **`loading.tsx` y `error.tsx`** del admin (antes pantalla en blanco o error genérico).
- **Credenciales e integraciones**: auditoría al guardar keys (sin valores), URL https, teléfonos E.164, zona horaria válida, y no deja prender recordatorios sin Twilio y número de envío.
- **Sweep**: `?stale=` validado con zod.

### Portal (16 arreglos)

- **Bandeja**: un borrador ya no se pasa a otra conversación; tomar control solo se permite si el cliente dejó email, y cada respuesta dice si se envió o por qué no. Antes se guardaba y pausaba al agente aunque no se entregara nada.
- **Emails aprobados**: el texto se escapa (antes el HTML que escribía el agente se renderizaba en el email) y el asunto usa el nombre del negocio, no el slug.
- **Nada interno a la vista**: el historial del sistema traduce los eventos a lenguaje simple y oculta los tuyos (rotaciones, vault, cobro). Se quitó el JSON de integraciones y el workspace id. El portal ya no importa código de costos del admin.
- **Seguridad**: el layout verifica la sesión antes de cargar datos del cliente (antes el nombre y el contador de aprobaciones se veían sin login).
- **Clientes** con mayúsculas en el email ya no dan 404.
- **Contador de aprobaciones** exacto (antes se quedaba en 10).
- **Aprobar/Rechazar**: botones bloqueados mientras se envía, doble toque ya no muestra error, errores en lenguaje simple.
- **Plurales en español** corregidos ("aprobaciónes pendientees" → "aprobaciones pendientes").
- **Todo bilingüe**: login, agentes, detalle del agente, bandeja, clientes, notas, cerrar sesión. Ya no aparece el nombre de una variable de entorno.
- **Sidebar** marca la página correcta al navegar; el logo lleva al inicio del portal, no al sitio de marketing.
- **Horas en la zona del negocio** (antes en UTC del servidor: una cita a las 10:00 salía 2:00 PM). Español con reloj de 12 horas (`es-US`).
- **Actividad en vivo**: fecha en mensajes viejos, cada fila abre la conversación, no consulta con la pestaña oculta.
- **Idioma en un toque**: EN | ES en el sidebar y en el menú móvil.

### Agentes (13 arreglos + 2 ajustes míos)

- **Link de reservas por agente** (`integrations.booking.link_url`, solo https). Sin link configurado, `request_booking` no se le ofrece al modelo. Solo `loucels-landing` y `-dev` usan tu Cal.com.
- **Reservas fail-closed**: si no se pueden leer las credenciales del sistema de Denise, las herramientas responden "no disponible" y se escala, en vez de agendar en local una cita que ella nunca ve. Timeout de 8 s a su API.
- **Un solo punto de envío proactivo** (`lib/notify/proactive.ts`): revisa STOP, consentimiento y horario (8am-9pm hora del negocio) antes de cualquier recordatorio, reseña o confirmación. Un test falla si otro módulo importa `sendSms`.
- **STOP en SMS**: funciona desde un número nuevo, acepta REVOKE, OPTOUT, PARAR, ALTO, BAJA y CANCELAR (solo como mensaje de una palabra), y un contacto dado de baja no recibe respuestas del agente.
- **SMS sin markdown** y con tope de 480 caracteres.
- **Honestidad ante fallas**: si Claude falla, se agota el tiempo o el loop llega al tope, se escala de verdad antes de decir "alguien te va a contactar".
- **Errores de base de datos** ya no llegan al cliente ("violates exclusion constraint…" → "ese horario ya está tomado").
- **SMS: dedupe por MessageSid, rate limit por contacto y por agente, y presupuesto** (sin migración; el índice único sigue pendiente).
- **Presupuesto con caché**: ahora cuenta los tokens de caché. Ajuste mío: ponderados por precio (escritura 1.25x, lectura 0.1x), porque contarlos completos habría agotado el presupuesto de 2M de `loucels-landing` y `naile-assistant` varias veces más rápido que el gasto real.
- **IDs de modelo centralizados** en `lib/ai/models.ts`, con los mismos valores de hoy.
- **Logs sin datos personales** (antes nombre, email y parte del mensaje iban a los logs de Vercel).
- **CORS en errores** y manejo seguro de varias herramientas en una misma respuesta.
- **Firma de Twilio** robusta a www vs apex.
- **Mensaje de escalación** (ajuste mío): el chat de Denise decía "Steven, el founder, te va a contactar". Ahora los agentes de clientes dicen "el equipo", sin prometer tus tiempos, y piden email o teléfono si el visitante no dejó ninguno.

### Ajustes después de integrar (míos)

- **Campo "Booking link"** en la config del agente (admin), guardado en `integrations.booking.link_url` y validado como https. Sin esto, devolverle las reservas a Denise requería SQL.
- **Portal correcto en la página del agente**: con dos portales en el mismo engagement (prod y dev) mostraba el de dev y rotar devolvía "ambiguous". Ahora usa el portal con el mismo nombre que el agente.

### También en esta pasada

- Markdown crudo (`**...**`) eliminado de bandeja, actividad en vivo y conversaciones del admin.
- Copy del portal y del admin sin guiones largos ni relleno; quitados "monitoreo 24/7", "nunca vemos los datos" y `billing@`.

### Cambios de comportamiento a tener en cuenta al desplegar

- `naile-assistant` deja de ofrecer reservas por link hasta que se configure `integrations.booking.link_url` con la página de reservas de Denise.
- El dueño solo puede responder desde la bandeja si el cliente dejó email.
- Los mensajes proactivos ahora se guardan en `messages_log`.
- El cron de recordatorios marca error (en vez de caer al camino sin chequeos) si no puede leer las credenciales de un agente.

---

## 3. Propuesta de simplificación (necesita tu visto bueno)

No se hizo porque quita páginas y cambia cómo trabajan tú y tus clientes.

### Admin: de 8 pantallas a 5

Hoy la misma cuenta aparece en 8 lugares, con 4 páginas de detalle distintas
(`crm/[id]`, `engagement/[id]`, `agent/[id]`, `clients`), y el MRR se calcula
de 8 maneras con 3 reglas diferentes.

1. **Hoy** (`/admin`): MRR, prospectos de la semana, lista "te necesita" (follow-ups, aprobaciones esperando o colgadas, clientes que pagan y están callados, crons que fallaron), actividad reciente.
2. **Clientes**: una sola lista (estado, MRR, horas ahorradas, alerta de silencio) con vista de pipeline. Reemplaza CRM, Clients y Agents.
3. **Cliente** (`/admin/clients/[id]`): pestañas Resumen, Conversaciones, Aprobaciones, Configuración (agente, cobro, integraciones, acceso al portal, código del widget). Reemplaza las 3 páginas de detalle.
4. **+ Cliente nuevo**: un solo formulario (negocio, email y teléfono del dueño, idioma, vertical, tipo de agente, sitio web) que crea cuenta, engagement, agente y portal de una vez, y abre una lista de pasos para terminar el setup. Hoy son 4 páginas y ~15 campos, más scripts.
5. **Ingresos** y **Configuración** como están; el chat del sitio (chat-pulse) pasa a ser una pestaña de tu propio cliente "Loucells Core".

Base técnica: un solo `lib/metrics.ts` compartido por admin y portal, y una
función SQL `admin_workspace_metrics(since)` que reemplaza las consultas que hoy
cortan en 1 000 filas sin avisar.

### Portal: de 9 páginas a 5

Hoy las aprobaciones pendientes aparecen 4 veces en el resumen, Integraciones
inventa estados ("ok" fijo) y Analytics casi nunca tiene datos.

1. **Inicio**: "te necesita" con aprobar/editar/rechazar en línea para las 3 primeras, 3 métricas de valor, citas de hoy, conversaciones recientes (con link), y abajo los gráficos de horas y temas.
2. **Bandeja**: web y SMS juntos, con el nombre del cliente, 4 filtros (Todas, Tomadas, Urgentes, Con cita) y estado de entrega en cada respuesta tuya.
3. **Aprobaciones**: cada tarjeta enlaza a su conversación; el historial dice Enviado / En proceso / Falló.
4. **Clientes**: contactos de web y SMS con notas.
5. **Configuración**: Plan, Tu agente (estado, canales, conexiones reales, código del widget; reemplaza Agentes, Agente e Integraciones) e Idioma.

### Agentes: un solo pipeline para web y SMS

Hoy hay tres copias del flujo (chat del sitio, chat de clientes, SMS), cada una
con sus propios controles: el SMS no pasa por DLP, no deja auditoría, no tiene
rate limit ni presupuesto. La propuesta (`src/lib/agent-runtime/`):

```
claim → admit → screen → loadHistory → buildPrompt → runLoop → record → renderForChannel
```

- `claim`: dedupe por MessageSid o nonce firmado.
- `admit`: rate limit, presupuesto, pausa por toma de control, opt-out.
- `screen`: DLP capa 1 + 2, una sola copia.
- `loadHistory`: historial desde el servidor (hoy lo manda el navegador y se puede falsificar).
- `runLoop`: responde todas las herramientas; al tope de iteraciones escala en vez de mandar "déjame revisar…".
- `record`: auditoría + transcripción encriptada + uso con tokens de caché.
- Adaptadores: `channels/web.ts` y `channels/sms.ts` (este último responde a Twilio al instante y procesa con `after()`).
- Config tipada por agente (`AgentConfigSchema`) y plantillas por vertical, para que agregar un cliente no requiera tocar código ni correr scripts.

Orden sugerido: P0 en sitio (hecho en esta rama) → config + modelos + registro
de herramientas → pipeline y adaptadores → retirar la ruta vieja `/api/chat`.

---

## 4. Decisiones para Steven

1. **Mitigación inmediata de Naile** (sección 1, #1): ¿quito `request_booking` de `naile-assistant` en la base mientras no se despliega?
2. **Scheduler para tareas frecuentes**: Vercel Hobby solo permite crons diarios. Opciones: plan Pro de Vercel, `pg_cron` en Supabase (una migración), o GitHub Actions cada 5 min (ya usas uno para business-pulse). Afecta el barrido de aprobaciones y las alertas de salud.
3. **Migraciones propuestas** (escritas solo cuando digas, ninguna aplicada):
   - Índice único en `messages_log.provider_sid` (dedupe real de SMS).
   - Tabla de escalaciones (hoy una escalación de SMS es solo un email que no se manda si las alertas están apagadas).
   - `client_portal_access.sessions_valid_after` (que rotar o revocar el passcode cierre las sesiones abiertas; hoy duran hasta 7 días).
   - PK de `paused_sessions` a `(engagement_id, session_id)`.
   - `pending_approvals.session_id` (link de la aprobación a su conversación).
   - Función `admin_workspace_metrics(since)`.
4. **Simplificación** (sección 3): ¿admin, portal y pipeline de agentes, en ese orden?
5. **Deploy**: el plan es un preview de Vercel desde la rama y probar ahí; `main` solo cuando lo apruebes.

---

## 5. Verificación (1 oct)

- `npx tsc --noEmit`: limpio.
- `npx vitest run`: 171 pasan, 1 omitido (redteam, necesita API key). Eran 57 al empezar.
- `eslint`: sin errores nuevos. Los que quedan ya existían (`Date.now()` en server components del admin/portal, y componentes viejos del sitio y de los demos).
- `next build`: OK.
- Recorrido local con sesión firmada (solo lectura): 52 de 52 páginas de admin y portal en 200, sin scroll horizontal, sin errores de JavaScript. Los dos 404 por página son los scripts de analítica de Vercel, que no existen en local.
- Pendientes menores que quedaron: fechas de la lista de clientes en hora del servidor, dos textos en inglés en Integraciones, "[encrypted]" sin traducir en la actividad, asunto del email de respuesta del dueño solo en inglés. Las respuestas del agente de la landing usan guiones largos porque el persona los usa.

---

## 6. Simplificación (aprobada el 1 oct) — hecho

### Admin: 5 lugares

- **Hoy** (`/admin/dashboard`): MRR, prospectos de 7 días (solo tus leads), horas ahorradas, y "Te necesita" ordenado por urgencia: aprobaciones colgadas más de 5 min, escalaciones abiertas (cuando exista la tabla), crons que fallaron, follow-ups vencidos, aprobaciones por cliente, clientes que pagan y están callados. Se fueron el texto "recap", los KPI repetidos y los paneles de embudo.
- **Clientes** (`/admin/clients`): una sola lista (reemplaza CRM, Clients y Agents), tarjetas en el teléfono, vista de pipeline con `?view=pipeline` (sin columnas vacías).
- **Cliente** (`/admin/clients/[accountId]`): pestañas Resumen, Conversaciones, Aprobaciones, Configuración. Configuración tiene la lista de pasos pendientes, el panel de cada agente (cobro, link de reservas, portal, widget), "agregar agente", y costos y auditoría bajo demanda.
- **+ Cliente nuevo** (`/admin/clients/new`): un formulario que crea cuenta, engagement, agente y portal, dice qué paso falló si algo falla, y "reintentar" no duplica. Termina en la lista de pasos del cliente.
- **Ingresos** y **Configuración** como estaban, con el MRR de la librería compartida.
- Las rutas viejas redirigen: `/admin/crm`, `/admin/crm/[id]`, `/admin/engagement/[id]`, `/admin/agent/[id]`, `/admin/agents`, `/admin/new-engagement`. No se borró ningún archivo.
- Pasar un agente a "Live" ahora revisa lo que necesita cada canal (web: slug, sitios, persona; SMS: credenciales de Twilio, número, horario, zona horaria).

### Portal: 5 páginas

- **Inicio**: un solo bloque "Te necesita" (las 3 primeras aprobaciones con aprobar/editar/rechazar ahí mismo, escalaciones, conversaciones que tomaste), 3 números, citas de hoy (web y SMS), conversaciones recientes con link, y los gráficos al final cuando hay datos suficientes.
- **Bandeja**: web y SMS en una lista, con el nombre del cliente, 4 filtros y etiquetas en un menú. En el teléfono, lista o conversación con botón para volver. SMS es de solo lectura por ahora.
- **Aprobaciones**: cada tarjeta enlaza a su conversación; el historial dice Enviado / En proceso / Falló / Rechazado.
- **Clientes**: contactos de web y SMS juntos (se unen solo si coinciden email o teléfono).
- **Configuración**: Plan, Tu agente (estado, canales, conexiones reales según el vault, link de reservas, código del widget) e Idioma. Se quitó "Historial del sistema".
- Rotar el passcode ahora cierra las sesiones abiertas (migración 063).
- Redirigen: `/agents`, `/agent/[id]`, `/integrations` → Configuración; `/analytics` → Inicio.

### Agentes: un pipeline

- `src/lib/agent-runtime/`: la ruta del chat web pasó de 993 a 26 líneas y la de SMS de 311 a 17. Pasos compartidos: dedupe, admisión (STOP, límites, pausa, presupuesto), DLP en una sola copia, historial desde el servidor, prompt, loop que responde todas las herramientas, escalación, registro.
- Config tipada por agente (horario, zona horaria, link de reservas, número de SMS) y plantillas por vertical (`salon`, `generic`): un cliente nuevo ya no requiere tocar código.
- SMS: responde a Twilio al instante y procesa después (`after()`); ahora pasa por DLP, deja auditoría y transcripción, y respeta la toma de control.
- Cambios visibles en el chat web en vivo (casos borde): el historial sale del servidor (un mensaje bloqueado por datos sensibles ya no se reenvía al modelo), todas las respuestas usan el idioma del widget, si el loop llega al tope escala en vez de dar error, sin guiones largos en los textos fijos.

### Migraciones

- 059, 061, 062, 063 aplicadas y verificadas el 1 oct.
- 064 (permiso de lectura de la función de métricas para el rol del admin): escrita, falta correrla.
- 060 (escalaciones): sin escribir. Cuando se escriba debe tener las columnas que el pipeline ya inserta: `workspace_id`, `agent_slug`, `channel`, `session_id`, `contact_id`, `reason`, `summary`, más `status`, `resolved_at`, `created_at`, y permisos de lectura para el rol del admin.

### Pendientes conocidos

- Las conversaciones por SMS no cuentan en las métricas hasta que el SMS esté en vivo (ahora sí deja auditoría).
- `src/app/api/chat/route.ts` (la ruta vieja del chat del sitio) ya no la usa nadie; quedó marcada como reemplazada, sin borrar.
- Archivos que quedaron sin uso (no borrados): `new-engagement/form.tsx`, `engagement/[id]/tabs/overview.tsx`, `integrations/embed-snippet.tsx`, `lib/portal/roi.ts` y claves viejas de `strings.ts`.

### Ajustes míos al integrar (1 oct)

- **Orden de los mensajes**: la pregunta del cliente y la respuesta del agente se guardaban con el mismo instante, así que salían en cualquier orden (la bandeja mostraba la respuesta arriba de la pregunta y, más grave, el historial que el pipeline nuevo le pasa al modelo podía ir desordenado). Ahora se guardan con 1 ms de diferencia y todas las lecturas (historial del agente, bandeja, admin) desempatan con la pregunta primero.
- **Bandeja vacía**: con el filtro "Todas" dice "No hay conversaciones en los últimos 30 días" en vez de "ningún resultado para este filtro".
- **Go-live**: el chequeo por canal del pipeline (`checkReadiness`) quedó conectado al botón "Live" del admin.
- **Sidebar**: "+ Cliente nuevo" con estilo de botón y "Clientes" ya no se marca dentro de "nuevo".

### Verificación final (1 oct)

- `tsc` limpio, 300 tests pasan (1 omitido: redteam, necesita API key), `next build` OK.
- Recorrido local: 57/57 páginas en 200, sin scroll horizontal, sin errores de JavaScript; las rutas viejas redirigen donde deben.
