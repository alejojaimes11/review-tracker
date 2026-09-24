import { Link } from 'react-router-dom'
import { Card, FOCUS_RING, Icon } from '../components/ui'

const STEPS = [
  {
    title: 'Lee las reseñas de Google',
    text: 'Dos veces al día (12:00 m. y 6:00 p. m., hora de Colombia) una tarea programada consulta a Apify el rating y el conteo de reseñas de cada negocio, y guarda las reseñas individuales más recientes, sin datos personales de quien reseña.',
  },
  {
    title: 'Guarda un historial que no se puede reescribir',
    text: 'Cada lectura queda como una foto (snapshot) que solo se agrega, nunca se modifica. De ahí salen las reseñas ganadas, la gráfica de crecimiento, la meta mensual y la comparación con el mes anterior.',
  },
  {
    title: 'La IA analiza lo que dicen los clientes',
    text: 'Con hasta 40 reseñas guardadas, la IA (Gemini, con un modelo de respaldo si falla) entrega fortalezas, oportunidades, temas, un plan de acción y respuestas listas para las reseñas negativas. Los números los calcula el servidor, y toda cita se descarta si no aparece literalmente en una reseña real.',
  },
  {
    title: 'Un motor aparte convierte hechos en avisos',
    text: 'El sistema registra eventos (reseñas nuevas, fallos de sincronización) y un motor independiente los agrupa en una sola notificación push, con horas de silencio de 10 p. m. a 7 a. m. Es idempotente: un mismo evento no genera dos avisos, aunque una ejecución se repita o se solape.',
  },
  {
    title: 'Solo el administrador edita',
    text: 'Los visitantes pueden mirar, agregar negocios y pedir análisis. Las escrituras están protegidas en la base de datos (RLS), los datos internos no son públicos, y las funciones sensibles solo aceptan llamadas del servidor o del administrador.',
  },
  {
    title: 'En construcción: enlaces privados por negocio',
    text: 'Cada dueño podrá abrir un enlace privado, sin crear cuenta, para ver su negocio y recibir avisos en su celular. La base ya existe (el token se guarda cifrado y se puede revocar); los avisos para clientes son la siguiente etapa.',
  },
]

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link
        to="/"
        className={`inline-flex items-center gap-1 rounded text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 ${FOCUS_RING}`}
      >
        <Icon path="arrowLeft" className="h-3.5 w-3.5" filled={false} />
        Volver
      </Link>

      <h1 className="mt-4 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Cómo funciona por dentro</h1>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
        MarketPulse convierte las reseñas de Google de cada negocio en un panel de seguimiento, análisis con IA y avisos, sin que el dueño tenga que
        revisar nada a mano.
      </p>

      <ol className="mt-6 space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.title}>
            <Card className="flex gap-4 p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/15 text-sm font-semibold text-violet-600 dark:text-violet-300">
                {i + 1}
              </span>
              <div>
                <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{step.title}</h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{step.text}</p>
              </div>
            </Card>
          </li>
        ))}
      </ol>

      <Card className="mt-6 p-4 text-sm text-gray-600 dark:text-gray-300">
        <p className="font-medium text-zinc-900 dark:text-zinc-100">Tecnología</p>
        <p className="mt-1">
          React + Vite + TypeScript + Tailwind, instalable como PWA; Supabase (Postgres con RLS, Edge Functions, Storage, tareas programadas) y Web Push. El
          código es público:{' '}
          <a
            href="https://github.com/alejojaimes11/review-tracker"
            target="_blank"
            rel="noreferrer"
            className={`rounded text-violet-500 hover:underline dark:text-violet-400 ${FOCUS_RING}`}
          >
            github.com/alejojaimes11/review-tracker
          </a>
          .
        </p>
      </Card>
    </div>
  )
}
