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
  created_at: string
  updated_at: string
}

export interface ReviewSnapshot {
  id: string
  business_id: string
  review_count: number
  rating: number | null
  created_at: string
}
