import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import type { Business, ReviewSnapshot } from '../types'

export function useBusinesses() {
  return useQuery({
    queryKey: ['businesses'],
    queryFn: async (): Promise<Business[]> => {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useTrashedBusinesses() {
  return useQuery({
    queryKey: ['businesses', 'trash'],
    queryFn: async (): Promise<Business[]> => {
      const { data, error } = await supabase
        .from('businesses')
        .select('*')
        .not('deleted_at', 'is', null)
        .order('deleted_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useBusiness(id: string) {
  return useQuery({
    queryKey: ['businesses', id],
    queryFn: async (): Promise<Business> => {
      const { data, error } = await supabase.from('businesses').select('*').eq('id', id).single()
      if (error) throw error
      return data
    },
  })
}

export function useSnapshots(businessId: string) {
  return useQuery({
    queryKey: ['snapshots', businessId],
    queryFn: async (): Promise<ReviewSnapshot[]> => {
      const { data, error } = await supabase
        .from('review_snapshots')
        .select('*')
        .eq('business_id', businessId)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })
}

export function useAddBusiness() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: string) => {
      const { data, error } = await supabase.functions.invoke('add-business', {
        body: { input },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data as Business
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businesses'] })
    },
  })
}

export function useStopTracking() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('businesses')
        .update({ status: 'stopped', stopped_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businesses'] })
    },
  })
}

export function useResumeTracking() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('businesses')
        .update({ status: 'active', stopped_at: null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businesses'] })
    },
  })
}

export function useDeleteBusiness() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      // Soft delete: moves to the Papelera instead of removing the row, so
      // it can be restored. History and settings stay intact either way.
      const { error } = await supabase
        .from('businesses')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businesses'] })
    },
  })
}

export function useRestoreBusiness() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('businesses').update({ deleted_at: null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businesses'] })
    },
  })
}

export function useResetBaseline(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data: business, error: fetchError } = await supabase
        .from('businesses')
        .select('current_reviews, current_rating')
        .eq('id', id)
        .single()
      if (fetchError) throw fetchError

      const { error } = await supabase
        .from('businesses')
        .update({
          initial_reviews: business.current_reviews,
          initial_rating: business.current_rating,
          started_at: new Date().toISOString(),
          last_growth_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businesses'] })
    },
  })
}

export interface SnapshotPoint {
  business_id: string
  review_count: number
  created_at: string
}

/** Snapshots from the trailing ~31 days, across all businesses in one query — feeds monthly-goal progress and dashboard sparklines. */
export function useRecentSnapshots() {
  return useQuery({
    queryKey: ['snapshots', 'recent'],
    queryFn: async (): Promise<SnapshotPoint[]> => {
      const since = new Date(Date.now() - 31 * 86_400_000).toISOString()
      const { data, error } = await supabase
        .from('review_snapshots')
        .select('business_id, review_count, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data
    },
  })
}

export function useUpdateBusinessSettings(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (settings: {
      update_frequency_hours: number
      billing_day: number | null
      category: string | null
      low_usage_days: number
      monthly_goal: number | null
      notes: string | null
      phone: string | null
    }) => {
      const { error } = await supabase.from('businesses').update(settings).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businesses'] })
    },
  })
}

export interface MonthlyReport {
  month: string
  url: string
}

export function useMonthlyReports(businessId: string) {
  return useQuery({
    queryKey: ['monthly-reports', businessId],
    queryFn: async (): Promise<MonthlyReport[]> => {
      const { data, error } = await supabase.storage.from('monthly-reports').list(businessId)
      if (error) throw error
      return (data ?? [])
        .filter((f) => f.name.endsWith('.csv'))
        .map((f) => ({
          month: f.name.replace('.csv', ''),
          url: supabase.storage.from('monthly-reports').getPublicUrl(`${businessId}/${f.name}`).data.publicUrl,
        }))
        .sort((a, b) => b.month.localeCompare(a.month))
    },
  })
}

export function useUploadPhoto(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File) => {
      const path = `${id}-${Date.now()}.${file.name.split('.').pop()}`
      const { error: uploadError } = await supabase.storage
        .from('business-photos')
        .upload(path, file, { upsert: true })
      if (uploadError) throw uploadError

      const { data } = supabase.storage.from('business-photos').getPublicUrl(path)

      const { error: updateError } = await supabase
        .from('businesses')
        .update({ photo_url: data.publicUrl })
        .eq('id', id)
      if (updateError) throw updateError
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['businesses'] })
    },
  })
}
