import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { LegalShell } from "@/components/legal-shell";
import { siteConfig } from "@/lib/site-config";

const UPDATED = "2026-05-21";

export const metadata = {
  title: "Terms of Service · Loucells Core",
};

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const isES = locale === "es";

  return (
    <LegalShell
      locale={locale}
      title={isES ? "Términos de Servicio" : "Terms of Service"}
      updated={UPDATED}
    >
      {isES ? (
        <>
          <p>
            Al usar este sitio o contratar nuestros servicios aceptas los
            siguientes términos.
          </p>

          <h2>1. Servicios</h2>
          <p>
            Loucells Core ofrece diseño web (Web Foundation), agentes de IA
            especializados (Departamentos de IA) y arquitectura/gobernanza de IA
            enterprise (Integration &amp; Control). El alcance específico de
            cada proyecto queda definido en la propuesta firmada (SOW) entre
            cliente y Loucells Core.
          </p>

          <h2>2. Pagos</h2>
          <p>
            Los proyectos se cobran según lo acordado en la propuesta.
            Típicamente: 50% al inicio, 50% a la entrega. Los retainers
            mensuales se cobran por adelantado el primer día del mes.
            Servicios paralizados por falta de pago se reanudan tras la
            regularización.
          </p>

          <h2>3. Propiedad intelectual y propiedad</h2>
          <p>
            El cliente es dueño de lo que importa para su negocio: sus
            propios datos, sus registros de clientes, y sus credenciales de
            acceso, que permanecen a nombre del cliente durante todo el
            engagement. El cliente puede exportar su data en cualquier
            momento. La filosofía es{" "}
            <em>operado por nosotros, controlado por ti</em>: las llaves
            están a tu nombre, y tú decides cuándo cancelar.
          </p>
          <p>
            Permanecen como propiedad de Loucells Core: el agente de IA y su
            código, la plataforma sobre la que corre, el Trust Stack,
            librerías reutilizables, frameworks de gobernanza, plantillas de
            audit logging y la metodología de implementación. El cliente
            licencia el uso del agente desplegado por la duración del
            engagement; el agente en sí no se transfiere. Al cancelar, el
            cliente retiene y exporta su data, las credenciales se revocan, y
            el agente se desconecta — no sigue corriendo.
          </p>

          <h2>4. Retainer mensual (gobernanza)</h2>
          <p>
            El retainer mensual no es alquiler de software. Cubre
            <em> gobernanza continua</em> del agente desplegado:
          </p>
          <ul>
            <li>Monitoreo de outputs para detectar desviaciones (drift)</li>
            <li>Actualizaciones del guion del agente según nuevos casos</li>
            <li>Tuning de performance y métricas de conversión</li>
            <li>Despliegue de canales o integraciones adicionales</li>
            <li>Mantenimiento de controles de seguridad alineados a estándares vigentes</li>
            <li>Reporte mensual de actividad y recomendaciones</li>
          </ul>
          <p>
            El cliente puede cancelar el retainer con aviso de 30 días. La
            arquitectura desplegada permanece operativa, pero la gobernanza
            activa cesa al final del período pagado.
          </p>

          <h2>5. Confidencialidad</h2>
          <p>
            Tratamos toda información de cliente como confidencial.
            Acuerdos NDA específicos están disponibles a solicitud.
          </p>

          <h2>6. Limitación de responsabilidad</h2>
          <p>
            Nuestra responsabilidad total queda limitada al monto pagado
            por el proyecto en cuestión. No nos hacemos responsables por
            daños indirectos, lucro cesante o consecuenciales.
          </p>

          <h2>7. Cambios a estos términos</h2>
          <p>
            Podemos actualizar estos términos. Cambios materiales serán
            notificados a clientes activos vía email.
          </p>

          <h2>Contacto</h2>
          <p>
            Preguntas:{" "}
            <a href={`mailto:${siteConfig.contactEmail}`}>
              {siteConfig.contactEmail}
            </a>
            .
          </p>
        </>
      ) : (
        <>
          <p>
            By using this site or hiring our services you accept the
            following terms.
          </p>

          <h2>1. Services</h2>
          <p>
            Loucells Core offers web design (Web Foundation), specialized AI
            agents (AI Departments), and enterprise AI architecture and
            governance (Integration &amp; Control). The specific scope of
            each project is defined in the signed proposal (SOW) between
            client and Loucells Core.
          </p>

          <h2>2. Payments</h2>
          <p>
            Projects are billed as agreed in the proposal. Typically: 50%
            upfront, 50% on delivery. Monthly retainers are billed in
            advance on the first day of each month. Services paused for
            non-payment resume after the balance is settled.
          </p>

          <h2>3. Intellectual property &amp; ownership</h2>
          <p>
            The client owns what matters to their business: their own data,
            their customer records, and their account credentials, which
            remain in the client&apos;s name throughout the engagement. The
            client may export their data at any time. The philosophy is{" "}
            <em>run by us, controlled by you</em>: the keys are in your name,
            and you decide when to cancel.
          </p>
          <p>
            What remains the property of Loucells Core: the AI agent and its
            source, the platform it runs on, the Trust Stack, reusable
            libraries, governance frameworks, audit logging templates, and the
            implementation methodology applied across clients. The client
            licenses the use of the deployed agent for the duration of the
            engagement; the agent itself is not transferred. On cancellation,
            the client retains and exports their data, the credentials are
            revoked, and the agent is disconnected — it does not continue
            running.
          </p>

          <h2>4. Monthly retainer (governance)</h2>
          <p>
            The monthly retainer is not software rental. It covers
            <em> continuous governance</em> of the deployed agent:
          </p>
          <ul>
            <li>Output monitoring to detect drift</li>
            <li>Script updates as new cases appear</li>
            <li>Performance tuning and conversion metrics</li>
            <li>Deployment of additional channels or integrations</li>
            <li>Maintenance of security controls aligned to current standards</li>
            <li>Monthly activity report and recommendations</li>
          </ul>
          <p>
            The client may cancel the retainer with 30 days&apos; notice. The
            deployed architecture remains operational, but active governance
            ceases at the end of the paid period.
          </p>

          <h2>5. Confidentiality</h2>
          <p>
            We treat all client information as confidential. Specific NDAs
            are available on request.
          </p>

          <h2>6. Limitation of liability</h2>
          <p>
            Our total liability is limited to the amount paid for the
            project in question. We are not liable for indirect, lost
            profits, or consequential damages.
          </p>

          <h2>7. Changes to these terms</h2>
          <p>
            We may update these terms. Material changes will be notified to
            active clients via email.
          </p>

          <h2>Contact</h2>
          <p>
            Questions:{" "}
            <a href={`mailto:${siteConfig.contactEmail}`}>
              {siteConfig.contactEmail}
            </a>
            .
          </p>
        </>
      )}
    </LegalShell>
  );
}
