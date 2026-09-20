export interface Business {
  id: string
  maps_url: string
  name: string
  photo_url: string | null
  billing_day: number | null
  initial_reviews: number
  current_reviews: number
  initial_rating: number | null
  current_rating: number | null
  started_at: string
  stopped_at: string | null
  status: 'active' | 'stopped'
  update_frequency_hours: number
  last_synced_at: string | null
  last_growth_at: string | null
  category: string | null
  low_usage_days: number
  last_sync_error: string | null
  monthly_goal: number | null
  deleted_at: string | null
  notes: string | null
  phone: string | null
  last_negative_review_at: string | null
  created_at: string
  updated_at: string
}

export type Priority = 'alta' | 'media' | 'baja'

export interface AnalysisAction {
  accion: string
  motivo: string
  prioridad: Priority
  respaldo: number
  cita: string
  // Added with the complete analysis — absent on older saved rows.
  plazo?: 'esta semana' | 'este mes' | 'próximos 3 meses'
  impacto?: string
  pasos?: string[]
}

export interface AnalysisStrength {
  tema: string
  detalle: string
  respaldo: number
  cita: string
}

export interface AnalysisOpportunity {
  tema: string
  detalle: string
  gravedad: Priority
  respaldo: number
  cita: string
}

export interface AnalysisTheme {
  nombre: string
  positivas: number
  negativas: number
}

export interface AnalysisReply {
  rating: number | null
  resena: string
  respuesta: string
}

export interface AnalysisStats {
  total: number
  con_calificacion: number
  promedio: number | null
  distribucion: Record<string, number>
  positivas_pct: number
  negativas_pct: number
  tendencia: 'sube' | 'baja' | 'estable' | null
  promedio_recientes: number | null
  promedio_anteriores: number | null
}

/** Everything beyond the original bien/mejorar/acciones. Empty `{}` on analyses saved before the complete version. */
export interface AnalysisDetail {
  resumen?: string
  estadisticas?: AnalysisStats
  fortalezas?: AnalysisStrength[]
  oportunidades?: AnalysisOpportunity[]
  temas?: AnalysisTheme[]
  respuestas?: AnalysisReply[]
}

export interface Analysis {
  id: string
  created_at: string
  review_count: number
  provider: string
  bien: string
  mejorar: string
  acciones: AnalysisAction[]
  detalle?: AnalysisDetail
}

export interface ReviewSnapshot {
  id: string
  business_id: string
  review_count: number
  rating: number | null
  created_at: string
}

/** A row of `notifications` as the admin's browser sees it (RLS: own, already due). */
export interface AppNotification {
  id: string
  type: string
  title: string
  body: string
  /** `url` is where a click goes; the rest depends on `type`. */
  data: { url?: string } & Record<string, unknown>
  status: 'pending' | 'sent' | 'failed'
  created_at: string
  read_at: string | null
}
