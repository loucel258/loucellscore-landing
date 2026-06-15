import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { LegalShell } from "@/components/legal-shell";
import { siteConfig } from "@/lib/site-config";

const UPDATED = "2026-05-21";

export const metadata = {
  title: "Privacy Policy · Loucells Core",
};

export default async function PrivacyPage({
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
      title={isES ? "Política de Privacidad" : "Privacy Policy"}
      updated={UPDATED}
    >
      {isES ? (
        <>
          <p>
            En Loucells Core respetamos tu privacidad. Esta política explica
            qué datos recopilamos, cómo los usamos y tus derechos.
          </p>

          <h2>Qué recopilamos</h2>
          <ul>
            <li>
              Datos que nos das voluntariamente al agendar una llamada o
              escribirnos por email (nombre, email, mensaje).
            </li>
            <li>
              Datos analíticos básicos del sitio (páginas vistas, dispositivo,
              referrer) recopilados de forma anónima.
            </li>
          </ul>

          <h2>Cómo lo usamos</h2>
          <ul>
            <li>Responder a tus consultas.</li>
            <li>Mejorar la calidad y rendimiento del sitio.</li>
            <li>Cumplir con obligaciones legales aplicables.</li>
          </ul>

          <h2>Compartir con terceros</h2>
          <p>
            No vendemos tus datos. Usamos proveedores cuidadosamente
            seleccionados para alojar el sitio (Vercel), agendar llamadas
            (Cal.com) y procesar email. Cada uno tiene su propia política
            de privacidad.
          </p>

          <h2>Chat widget de esta landing</h2>
          <p>
            El widget de chat en la esquina inferior derecha es un demo en
            vivo del mismo Trust Stack que entregamos a clientes. Por
            transparencia, esto es lo que registra:
          </p>
          <ul>
            <li>
              Cada mensaje (tuyo y del agente) se escribe en un audit log
              Postgres <strong>append-only</strong>, identificado por un
              session_id aleatorio generado en tu navegador (no es una
              cookie de tracking; vive solo en sessionStorage de tu tab).
            </li>
            <li>
              El contenido literal de los mensajes <strong>NO se guarda</strong>
              {" "} — solo un hash SHA-256 del texto sanitizado. La conversación
              en sí vive únicamente en la memoria de tu navegador.
            </li>
            <li>
              Si pegas accidentalmente PII de alto riesgo (SSN, tarjeta,
              cuenta bancaria, API key), el sistema la detecta y rechaza
              el mensaje <strong>antes</strong> de enviarlo al modelo.
            </li>
            <li>
              Puedes ver tu propio audit trail en cualquier momento desde el
              botón &quot;Audit trail&quot; en el pie del chat — verás solo
              tus eventos, nunca los de otros visitantes.
            </li>
            <li>
              El registro de auditoría guarda metadata de integridad
              no-personal y un hash criptográfico del mensaje — no el
              contenido en texto plano. Ese registro no-personal se conserva
              para mantener verificable la hash chain. Si quieres que
              eliminemos datos personales atados a tu sesión, escríbenos a{" "}
              <a href={`mailto:${siteConfig.contactEmail}`}>
                {siteConfig.contactEmail}
              </a>
              .
            </li>
          </ul>

          <h2>Datos procesados por sistemas de IA (clientes activos)</h2>
          <p>
            Cuando Loucells Core opera agentes de IA para un cliente, los datos
            de ese cliente y sus clientes finales se procesan bajo principios
            estrictos de gobernanza:
          </p>
          <ul>
            <li>
              <strong>Sin entrenamiento con tu data:</strong> usamos las APIs
              comerciales de Anthropic (Claude); bajo sus términos comerciales,
              tus inputs no se usan para entrenar modelos fundacionales.
            </li>
            <li>
              <strong>Cifrado:</strong> TLS 1.3 en tránsito y AES-256 en reposo
              a nivel de volumen de base de datos.
            </li>
            <li>
              <strong>Enmascaramiento de PII:</strong> los campos sensibles
              (SSN, tarjetas, direcciones, datos de identificación) se
              enmascaran antes de ser enviados al modelo de lenguaje.
            </li>
            <li>
              <strong>Audit trail tamper-evident:</strong> cada acción del
              agente queda registrada append-only con integridad de hash
              chain, de modo que cualquier alteración es detectable en el
              siguiente chequeo de integridad.
            </li>
            <li>
              <strong>Aislamiento por workspace:</strong> los datos de cada
              cliente se aíslan mediante Row Level Security en la base de datos.
            </li>
          </ul>

          <h2>Tus derechos</h2>
          <p>
            Puedes solicitar acceso, corrección o eliminación de tus datos
            personales en cualquier momento escribiendo a{" "}
            <a href={`mailto:${siteConfig.contactEmail}`}>
              {siteConfig.contactEmail}
            </a>
            .
          </p>

          <h2>Contacto</h2>
          <p>
            Para cualquier consulta sobre privacidad escribinos a{" "}
            <a href={`mailto:${siteConfig.contactEmail}`}>
              {siteConfig.contactEmail}
            </a>
            .
          </p>
        </>
      ) : (
        <>
          <p>
            At Loucells Core we respect your privacy. This policy explains what
            data we collect, how we use it, and your rights.
          </p>

          <h2>What we collect</h2>
          <ul>
            <li>
              Data you voluntarily provide when booking a call or emailing us
              (name, email, message).
            </li>
            <li>
              Basic anonymous analytics (page views, device, referrer).
            </li>
          </ul>

          <h2>How we use it</h2>
          <ul>
            <li>Respond to your inquiries.</li>
            <li>Improve site quality and performance.</li>
            <li>Comply with applicable legal obligations.</li>
          </ul>

          <h2>Third parties</h2>
          <p>
            We don&apos;t sell your data. We use carefully chosen providers
            for hosting (Vercel), scheduling (Cal.com), and email. Each has
            its own privacy policy.
          </p>

          <h2>Landing chat widget</h2>
          <p>
            The chat widget in the bottom-right corner is a live demo of the
            same Trust Stack we deploy for clients. For transparency, this
            is what it records:
          </p>
          <ul>
            <li>
              Every message (yours and the agent&apos;s) is written to an
              <strong> append-only</strong> Postgres audit log, identified by
              a random session_id generated in your browser (not a tracking
              cookie; lives only in your tab&apos;s sessionStorage).
            </li>
            <li>
              The literal content of messages is <strong>NOT stored</strong>
              {" "}— only a SHA-256 hash of the sanitized text. The
              conversation itself lives only in your browser&apos;s memory.
            </li>
            <li>
              If you accidentally paste high-risk PII (SSN, credit card,
              bank account, API key), the system detects and rejects the
              message <strong>before</strong> sending it to the model.
            </li>
            <li>
              You can view your own audit trail at any time via the
              &quot;Audit trail&quot; button in the chat footer — you only
              see your events, never anyone else&apos;s.
            </li>
            <li>
              The audit record stores non-personal integrity metadata and a
              cryptographic hash of the message — not the plaintext content.
              This non-personal record is retained to keep the hash-chain
              verifiable. To request deletion of personal data tied to your
              session, email{" "}
              <a href={`mailto:${siteConfig.contactEmail}`}>
                {siteConfig.contactEmail}
              </a>
              .
            </li>
          </ul>

          <h2>Data processed by AI systems (active clients)</h2>
          <p>
            When Loucells Core operates AI agents for a client, the client&apos;s
            data and end-customer data are processed under strict governance
            principles:
          </p>
          <ul>
            <li>
              <strong>No training on your data:</strong> we use Anthropic&apos;s
              commercial Claude APIs; under their commercial terms, your
              inputs are not used to train foundation models.
            </li>
            <li>
              <strong>Encryption:</strong> TLS 1.3 in transit and AES-256 at
              rest at the database volume level.
            </li>
            <li>
              <strong>PII masking:</strong> sensitive fields (SSN, payment
              cards, addresses, identification data) are masked before they
              reach the language model.
            </li>
            <li>
              <strong>Tamper-evident audit trail:</strong> every agent action
              is logged append-only with hash-chain integrity, so any
              alteration is detectable on the next integrity check.
            </li>
            <li>
              <strong>Workspace isolation:</strong> client data is isolated
              using Row Level Security at the database layer.
            </li>
          </ul>

          <h2>Your rights</h2>
          <p>
            You can request access, correction, or deletion of your personal
            data at any time by emailing{" "}
            <a href={`mailto:${siteConfig.contactEmail}`}>
              {siteConfig.contactEmail}
            </a>
            .
          </p>

          <h2>Contact</h2>
          <p>
            For any privacy questions email{" "}
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
