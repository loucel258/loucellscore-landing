import type { Metadata } from "next";
import "@fontsource/fraunces/500.css";
import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/700.css";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/700.css";

export const metadata: Metadata = {
  title: "Café Meridiano — Café de especialidad en Denver",
  description:
    "Tostadores de café de especialidad en el centro de Denver. Grano propio, origen directo, barrio real.",
  robots: { index: false, follow: false },
};

const menu = [
  { name: "Espresso", desc: "Doble, tueste medio-oscuro", price: "$3.25" },
  { name: "Cappuccino", desc: "Leche entera, textura sedosa", price: "$4.75" },
  { name: "Latte de lavanda", desc: "Jarabe de lavanda casero", price: "$5.50" },
  { name: "Cold brew", desc: "Reposo de 18 horas", price: "$4.50" },
  { name: "Croissant de almendra", desc: "Horneado cada mañana", price: "$4.25" },
  { name: "Pan de banano y nuez", desc: "Receta de la abuela Salazar", price: "$3.75" },
];

const stats = [
  { n: "6", label: "años tostando en Denver" },
  { n: "12", label: "orígenes distintos" },
  { n: "100%", label: "relación directa con productores" },
];

const testimonios = [
  {
    quote:
      "El mejor cold brew que he probado en Denver. Vengo cada sábado sin falta.",
    name: "Elena R.",
  },
  {
    quote:
      "Ambiente perfecto para trabajar y el latte de lavanda es adictivo.",
    name: "Marcus T.",
  },
  {
    quote:
      "Se nota que tuestan el café ellos mismos. Se siente fresco de verdad.",
    name: "Priya K.",
  },
];

const horario = [
  { dias: "Lunes – Viernes", horas: "6:30 am – 6:00 pm" },
  { dias: "Sábado – Domingo", horas: "7:00 am – 5:00 pm" },
];

export default function SandboxPage() {
  return (
    <div
      className="min-h-screen"
      style={{
        // Paleta propia de Café Meridiano — deliberadamente distinta del
        // slate/cyan de Loucells Core: esta página es un negocio inventado
        // aparte, no una sección del sitio real.
        ["--font-fraunces" as string]: "'Fraunces', serif",
        ["--font-dm-sans" as string]: "'DM Sans', sans-serif",
        fontFamily: "var(--font-dm-sans)",
        backgroundColor: "#FAF3E7",
        color: "#2B1B12",
      }}
    >
      {/* NAV */}
      <header className="sticky top-0 z-40 border-b border-[#2B1B12]/10 bg-[#FAF3E7]/90 backdrop-blur">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <a
            href="#top"
            className="text-lg tracking-tight"
            style={{ fontFamily: "var(--font-fraunces)", fontWeight: 600 }}
          >
            MERIDIANO
          </a>
          <div className="hidden items-center gap-8 text-sm md:flex">
            <a href="#nosotros" className="hover:opacity-60">
              Nosotros
            </a>
            <a href="#menu" className="hover:opacity-60">
              Menú
            </a>
            <a href="#ubicacion" className="hover:opacity-60">
              Ubicación
            </a>
            <a href="#contacto" className="hover:opacity-60">
              Contacto
            </a>
          </div>
          <a
            href="#contacto"
            className="rounded-full px-5 py-2 text-sm font-medium text-[#FAF3E7] transition-transform hover:scale-105"
            style={{ backgroundColor: "#C1502E" }}
          >
            Visítanos
          </a>
        </nav>
      </header>

      <main id="top">
        {/* HERO */}
        <section className="mx-auto max-w-6xl px-6 pt-16 pb-20 md:pt-24 md:pb-28">
          <p
            className="mb-4 text-xs font-medium tracking-[0.25em] uppercase"
            style={{ color: "#C1502E" }}
          >
            Tostado en Denver desde 2019
          </p>
          <h1
            className="max-w-3xl text-[2.75rem] leading-[0.95] tracking-tight md:text-[5rem]"
            style={{ fontFamily: "var(--font-fraunces)", fontWeight: 600 }}
          >
            Café que empieza
            <br />
            tu día bien.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed opacity-80">
            Grano de especialidad, tostado propio, servido por gente del
            barrio. Sin prisa, sin relleno.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <a
              href="#menu"
              className="rounded-full px-6 py-3 text-sm font-medium text-[#FAF3E7] transition-transform hover:scale-105"
              style={{ backgroundColor: "#2B1B12" }}
            >
              Ver el menú
            </a>
            <a
              href="#ubicacion"
              className="rounded-full border px-6 py-3 text-sm font-medium transition-transform hover:scale-105"
              style={{ borderColor: "#2B1B12" }}
            >
              Cómo llegar
            </a>
          </div>
        </section>

        {/* STATS */}
        <section
          className="border-y border-[#2B1B12]/10 py-10"
          style={{ backgroundColor: "#F0E4D0" }}
        >
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 px-6 sm:grid-cols-3">
            {stats.map((s) => (
              <div key={s.label} className="text-center">
                <div
                  className="text-4xl"
                  style={{ fontFamily: "var(--font-fraunces)", color: "#C1502E" }}
                >
                  {s.n}
                </div>
                <div className="mt-1 text-sm opacity-70">{s.label}</div>
              </div>
            ))}
          </div>
        </section>

        {/* NOSOTROS */}
        <section id="nosotros" className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <div className="grid gap-10 md:grid-cols-2 md:gap-16">
            <div>
              <p
                className="mb-3 text-xs font-medium tracking-[0.25em] uppercase"
                style={{ color: "#C1502E" }}
              >
                Nuestra historia
              </p>
              <h2
                className="text-3xl md:text-4xl"
                style={{ fontFamily: "var(--font-fraunces)", fontWeight: 600 }}
              >
                Empezó con dos hermanos y una tostadora usada.
              </h2>
            </div>
            <div className="space-y-4 text-base leading-relaxed opacity-80">
              <p>
                Marta e Iván Salazar abrieron Meridiano en 2019 en un local de
                60 metros cuadrados en el centro de Denver, con una tostadora
                de segunda mano y contactos directos con fincas cafeteras en
                Huila (Colombia) y Yirgacheffe (Etiopía).
              </p>
              <p>
                Hoy seguimos tostando en el mismo barrio, en lotes pequeños,
                cada semana. Pagamos precio directo al productor y publicamos
                el origen de cada saco en el menú.
              </p>
            </div>
          </div>
        </section>

        {/* MENU */}
        <section
          id="menu"
          className="border-y border-[#2B1B12]/10 py-20 md:py-28"
          style={{ backgroundColor: "#2B1B12", color: "#FAF3E7" }}
        >
          <div className="mx-auto max-w-6xl px-6">
            <p
              className="mb-3 text-xs font-medium tracking-[0.25em] uppercase"
              style={{ color: "#E08A5D" }}
            >
              En la barra
            </p>
            <h2
              className="mb-12 text-3xl md:text-4xl"
              style={{ fontFamily: "var(--font-fraunces)", fontWeight: 600 }}
            >
              El menú de siempre.
            </h2>
            <div className="grid gap-x-12 gap-y-6 md:grid-cols-2">
              {menu.map((item) => (
                <div
                  key={item.name}
                  className="flex items-baseline justify-between gap-4 border-b border-[#FAF3E7]/15 pb-4"
                >
                  <div>
                    <div className="text-lg font-medium">{item.name}</div>
                    <div className="text-sm opacity-60">{item.desc}</div>
                  </div>
                  <div
                    className="shrink-0 text-lg"
                    style={{ fontFamily: "var(--font-fraunces)" }}
                  >
                    {item.price}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* TESTIMONIOS */}
        <section className="mx-auto max-w-6xl px-6 py-20 md:py-28">
          <p
            className="mb-3 text-xs font-medium tracking-[0.25em] uppercase"
            style={{ color: "#C1502E" }}
          >
            Lo que dice el barrio
          </p>
          <h2
            className="mb-12 max-w-xl text-3xl md:text-4xl"
            style={{ fontFamily: "var(--font-fraunces)", fontWeight: 600 }}
          >
            No lo decimos nosotros.
          </h2>
          <div className="grid gap-6 md:grid-cols-3">
            {testimonios.map((t) => (
              <figure
                key={t.name}
                className="rounded-2xl border border-[#2B1B12]/10 p-6"
                style={{ backgroundColor: "#F0E4D0" }}
              >
                <blockquote className="text-base leading-relaxed opacity-90">
                  &ldquo;{t.quote}&rdquo;
                </blockquote>
                <figcaption
                  className="mt-4 text-sm font-medium"
                  style={{ color: "#C1502E" }}
                >
                  {t.name}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>

        {/* UBICACION + CONTACTO */}
        <section
          id="ubicacion"
          className="border-t border-[#2B1B12]/10 py-20 md:py-28"
          style={{ backgroundColor: "#F0E4D0" }}
        >
          <div className="mx-auto grid max-w-6xl gap-12 px-6 md:grid-cols-2">
            <div>
              <p
                className="mb-3 text-xs font-medium tracking-[0.25em] uppercase"
                style={{ color: "#C1502E" }}
              >
                Visítanos
              </p>
              <h2
                className="mb-6 text-3xl md:text-4xl"
                style={{ fontFamily: "var(--font-fraunces)", fontWeight: 600 }}
              >
                1420 Larimer St
                <br />
                Denver, CO 80202
              </h2>
              <dl className="space-y-2 text-base opacity-80">
                {horario.map((h) => (
                  <div key={h.dias} className="flex justify-between gap-6">
                    <dt>{h.dias}</dt>
                    <dd>{h.horas}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div id="contacto">
              <p
                className="mb-3 text-xs font-medium tracking-[0.25em] uppercase"
                style={{ color: "#C1502E" }}
              >
                Contacto
              </p>
              <h2
                className="mb-6 text-3xl md:text-4xl"
                style={{ fontFamily: "var(--font-fraunces)", fontWeight: 600 }}
              >
                Escríbenos.
              </h2>
              <div className="space-y-2 text-base opacity-80">
                <p>hola@cafemeridiano.example</p>
                <p>(303) 555-0148</p>
              </div>
              <a
                href="mailto:hola@cafemeridiano.example"
                className="mt-6 inline-block rounded-full px-6 py-3 text-sm font-medium text-[#FAF3E7] transition-transform hover:scale-105"
                style={{ backgroundColor: "#C1502E" }}
              >
                Enviar un mensaje
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* FOOTER */}
      <footer className="border-t border-[#2B1B12]/10 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm opacity-60 md:flex-row">
          <span style={{ fontFamily: "var(--font-fraunces)" }}>MERIDIANO</span>
          <span>
            Página de ejemplo con información inventada — no es un negocio
            real.
          </span>
          <span>© 2026 Café Meridiano</span>
        </div>
      </footer>
    </div>
  );
}
