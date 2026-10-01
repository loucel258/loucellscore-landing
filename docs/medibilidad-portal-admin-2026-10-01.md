# ¿Qué tan medible y útil es el portal (y el admin)? — 1 oct 2026

Comparado con lo que muestran otros productos del mismo espacio y con los
datos reales de la base (consultas de solo lectura del 1 oct).

---

## 1. Veredicto

El portal es un buen visor de conversaciones, pero no demuestra valor. Mide
**actividad** (conversaciones, citas que el agente agendó, horas estimadas) y
no **resultados de negocio** (dinero de citas que el agente generó o protegió,
clientes atendidos fuera de horario, no-shows evitados, rapidez de respuesta).
Para el único cliente real hoy mostraría ceros en todo, y no por un bug del
portal: el servicio no está entregando nada que medir.

El admin tiene el mismo problema visto desde tu lado: sabe cuánto te cuesta
cada cliente, pero no qué valor le entregas ni si su agente realmente está
funcionando.

---

## 2. Qué muestran los demás

**Recepcionistas con IA y mensajería para negocios locales**

| Producto | Lo que el dueño ve |
|---|---|
| My AI Front Desk | Ingresos generados con comparación mes a mes, llamadas atendidas, citas, desglose por canal (teléfono, chat, SMS), "ingresos recuperados" de fuera de horario y llamadas perdidas, embudo, horas pico, exportar CSV |
| Zenoti (salones y spas) | Ingresos agendados por la IA, llamadas atendidas, citas, tasa de traspaso a humano, por sucursal, grabación y resumen de cada llamada, categoría (perdida, fuera de horario) |
| Smith.ai | Historial con resumen, resultado, prioridad y relevancia de cada llamada; clientes nuevos vs existentes; días y horas con más llamadas; leads calificados vs no; resumen instantáneo por email, texto o Slack |
| Goodcall | Tasa de automatización, intención y resultado de cada interacción |
| Podium / Birdeye | Bandeja unificada, tiempo de respuesta, reseñas y su sentimiento, pagos, y **reportes que llegan solos por email** (diario, semanal o mensual) |

Patrón común: el número principal es **dinero** (generado o recuperado), cada
conversación tiene un **resultado** claro, y el dueño **recibe** el resumen sin
tener que entrar.

**Consolas de agencia (tu lado)**

| Producto | Lo que ve el dueño de la agencia |
|---|---|
| GoHighLevel (agencia) | MRR, churn, cuentas activas, uso por cliente (SMS, llamadas, email), clientes en riesgo por pocos logins o actividad en baja, entrada a cada cliente, alta de clientes con plantillas |
| Synthflow (plan agencia) | Uso por cliente (minutos), precios propios, refacturación con Stripe, subcuentas |

---

## 3. Qué mide hoy el portal (honesto)

| Número | Cómo se calcula | ¿Sirve como prueba? |
|---|---|---|
| Conversaciones atendidas | Sesiones de chat web en la auditoría | Sí para web. El SMS todavía no cuenta |
| Citas confirmadas | Leads con cita confirmada + citas creadas por el agente | Para Naile siempre 0: sus citas las crea su app, el agente nunca agenda directo |
| Horas recuperadas | Conversaciones × 5 minutos | No: es una estimación |
| Recordatorios, confirmaciones, reseñas | No aparecen en ningún número | Es justo lo que el agente hace por Naile |

---

## 4. Lo que dicen los datos reales

- **Ningún cliente real tiene portal.** Los 3 portales (`acme-medspa`, `loucels-landing`, `loucels-landing-dev`) cuelgan del engagement demo Acme. Denise no tiene portal.
- **Naile:** 0 conversaciones de chat, 0 SMS, 0 recordatorios enviados, 2 citas espejadas de su app (1 completada, 1 programada). Las 206 filas de auditoría de su workspace son todas de sistema (lecturas del vault y del sistema de reservas).
- **El chat no está instalado en el sitio de Denise** (ni en la página en vivo ni en el código de su app). El agente figura "live" desde el 26 de junio, pero nadie ha podido hablarle. Lo bueno: ningún cliente suyo recibió el link a tu Cal.com.
- **Retainer de Naile: $0 e inactivo**, por eso tu MRR en el admin es $0. Y como la alerta de "cliente callado" solo mira clientes que pagan, nada te avisó que su agente no tiene tráfico desde junio.
- **No hay línea base** (`guarantee_baselines` vacía): hoy no hay forma de mostrar "antes vs después".
- **Las citas espejadas entran sin servicio** (`service_id` vacío). Los servicios sí tienen precio, pero sin ese enlace no se puede calcular cuánto vale cada cita.

---

## 5. La pieza que ya existe y no se usa

`src/lib/roi/attribution.ts` (migración 058) clasifica cada cita sin IA, con
reglas que se pueden recalcular desde la base:

- **Directa**: la creó el agente.
- **Influida**: la reservó el cliente en otro lado, pero habló con el agente en los días previos.
- **Protegida**: sin conversación, pero el recordatorio del agente corrió y la cita se cumplió. Se cuenta, nunca se cobra como ingreso.
- **Ingresos**: solo citas **completadas**, al precio del servicio.

Más `guarantee_baselines` para la línea base del "antes". Es exactamente el
número principal que muestran los demás, con una regla más defendible que
"horas ahorradas".

---

## 6. Qué le falta al portal (en orden)

1. **Número principal en dinero, con la atribución que ya existe.** "Citas que tu agente generó, influyó o protegió" y "$ de citas completadas atribuidas", con la regla explicada en una línea. "Horas ahorradas" baja a número secundario.
2. **Antes vs ahora.** Cargar 3 o 4 números en el onboarding (citas por mes, % de no-shows, llamadas perdidas, tiempo de respuesta) y mostrar la comparación.
3. **Medir lo que hace el front desk:** recordatorios enviados y asistencia de esas citas, confirmaciones, reseñas pedidas.
4. **Fuera de horario y rapidez:** % de conversaciones fuera de horario y tiempo hasta la primera respuesta (sale de datos que ya se guardan).
5. **Estado del servicio, honesto.** Un bloque "qué está activo": chat instalado en tu web (sí/no y última visita), SMS (esperando registro), recordatorios (activos, último envío). Explica los ceros en vez de esconderlos.
6. **Resultado por conversación:** agendó, escaló, solo información, sin respuesta. El pipeline ya sabe el resultado de cada turno.
7. **Resumen que llega solo:** un email semanal al dueño con 4 números y un link. Es un envío hacia afuera, así que los primeros pasarían por tu aprobación.
8. **Aviso inmediato** al dueño cuando algo requiere acción (aprobación, escalación), por email o texto.
9. Exportar CSV.

## 7. Qué le falta al admin (en orden)

1. **Salud real de cada agente:** ¿el widget recibe tráfico?, ¿el SMS está registrado?, ¿los recordatorios salen?, última conversación real. Alerta si un agente "live" no tiene tráfico en 7 días, pague o no.
2. **Valor entregado por cliente:** la misma atribución del portal. Sirve para renovar y para el case study de Naile, que está pendiente justamente por falta de datos.
3. **Línea base y garantía por cliente:** formulario para cargarla y días que le quedan a la garantía.
4. **Adopción del portal:** último login del cliente (el dato ya existe).
5. **Cobros:** pagado o atrasado, y próxima factura (el webhook de Stripe ya existe).
6. **Uso vs presupuesto por cliente:** aviso cuando se acerca al límite.

---

## 8. Recomendación

**Antes de escribir código (esta semana):**
- Instalar el chat en el sitio de Denise.
- Crearle su portal.
- Cargar su retainer en el admin.
- Terminar el 10DLC (ver memoria `naile-twilio-pending`).

Sin esto, ningún portal va a mostrar nada.

**Después, en código:**
1. Estado del servicio en el portal + alerta de "agente sin tráfico" en el admin. Es barato y evita que otro agente quede muerto en silencio.
2. Conectar la atribución: arreglar el enlace cita → servicio en el espejo, formulario de línea base en el admin, y el número principal en dinero en el portal y en el admin.
3. Reporte semanal por email, con tu aprobación en los primeros envíos.
4. Avisos inmediatos, resultado por conversación y CSV.

---

Fuentes: [My AI Front Desk: dashboards](https://www.myaifrontdesk.com/platform/dashboards-reporting) · [Zenoti AI Receptionist](https://www.zenoti.com/ai-workforce/ai-receptionist) · [Smith.ai call dashboard](https://smith.ai/blog/call-dashboard-now-available-for-smith-ai-virtual-receptionists) · [Smith.ai lead intake](https://smith.ai/features/lead-screening-intake-service) · [Goodcall](https://www.goodcall.com/) · [Podium (Capterra)](https://www.capterra.com/p/164285/Podium/) · [Birdeye review reports](https://support.birdeye.com/en/articles/12653724-understanding-birdeye-reports-review-reports) · [GoHighLevel agency dashboard](https://ecosire.com/blog/ghl-agency-dashboard-guide) · [Synthflow agency plan](https://www.leadlock.ai/blog/unveiling-synthflow-ais-agency-plan-a-deep-dive/)

---

## 9. Hecho (1 oct, rama `rediseno-home`, sin deploy)

**Capas compartidas (mías, con tests):** `src/lib/value.ts` (valor entregado con el motor de atribución, ingresos solo de citas completadas al precio real de la reserva), `src/lib/service-status.ts` (qué está funcionando por canal; agentes "live" sin tráfico 7+ días), `src/lib/conversation-stats.ts` (fuera de horario, rapidez de respuesta por SMS, resultado de cada conversación), `src/lib/db-paging.ts` (paginación: PostgREST corta en 1000 filas sin avisar). El espejo guarda el precio de cada cita (`totalAmount` de la app de Denise).

**Portal:** números principales en valor (citas gracias al agente, ingresos de citas realizadas, conversaciones) con selector 7/30/90 días y la regla en una línea; "Qué está funcionando" (explica los ceros); resultados del front desk (recordatorios, asistencia, no-shows) con antes vs ahora si hay línea base; fuera de horario; resultado por conversación en la bandeja; exportar CSV.

**Admin:** salud por cliente (lista y página de cliente), alerta en "Hoy" para agentes en vivo sin tráfico (pague o no), valor entregado (30 días y desde el go-live), formulario de línea base y garantía, uso de tokens vs presupuesto, último ingreso al portal, pagos (solo los de Stripe de una vez; los retainers no pasan por Stripe), y **reportes semanales**: un cron arma borradores cada lunes, tú los revisas en `/admin/reports` y se envían solo con "Aprobar y enviar". Nada sale solo.

**Migraciones:** 065 y 066 aplicadas y verificadas el 1 oct.

**Pendientes para Denise (cuando su web esté lista):** instalar el chat en su sitio, crearle su portal, cargar su retainer y su link de reservas, línea base de la garantía, terminar 10DLC. Las 2 citas espejadas siguen sin precio hasta que su app las vuelva a enviar (el cron `booking-sync` las re-sincroniza con `totalAmount`).

**Verificación:** `tsc` limpio, 406 tests, `next build` OK, 57/57 páginas locales en 200.
