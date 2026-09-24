import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

// Admin-only. The token comes back ONLY from create/regenerate, once; list never has it.

export interface AccessLink {
  id: string
  business_id: string
  token_prefix: string
  label: string | null
  created_at: string
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  status: 'active' | 'revoked' | 'expired'
  devices: number
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-client-links', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null)
      throw new Error(payload?.error ?? error.message)
    }
    throw error
  }
  return data as T
}

const key = (businessId: string) => ['access-links', businessId]

export function useAccessLinks(businessId: string, enabled: boolean) {
  return useQuery({
    queryKey: key(businessId),
    enabled,
    queryFn: async () => (await call<{ links: AccessLink[] }>({ action: 'list', business_id: businessId })).links,
  })
}

export function useCreateAccessLink(businessId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (label: string) => call<{ link: AccessLink; token: string }>({ action: 'create', business_id: businessId, label }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(businessId) }),
  })
}

export function useRegenerateAccessLink(businessId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (linkId: string) => call<{ link: AccessLink; token: string }>({ action: 'regenerate', link_id: linkId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(businessId) }),
  })
}

export function useRevokeAccessLink(businessId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (linkId: string) => call<{ ok: true }>({ action: 'revoke', link_id: linkId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key(businessId) }),
  })
}
