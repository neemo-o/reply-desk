import { apiClient } from "./api-client";
import type { TenantMember } from "@/types/billing";
import type { TenantRole } from "@/types/auth";

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  status: string;
  createdAt: string;
  timezone?: string;
  language?: string;
}

export interface TenantDetails {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  timezone: string;
  language: string;
}

export interface UpdateTenantPayload {
  name?: string;
  slug?: string;
  logo?: string | null;
  timezone?: string;
  language?: string;
}

export interface UpdateMemberRolePayload {
  roleName: TenantRole;
}

export interface InviteMemberPayload {
  email: string;
  roleName: TenantRole;
}

export const tenantsService = {
  async findMine(): Promise<TenantSummary[]> {
    const { data } = await apiClient.get<TenantSummary[]>("/tenants/mine");
    return data;
  },

  async listMembers(): Promise<TenantMember[]> {
    const { data } = await apiClient.get<TenantMember[]>("/tenants/members");
    return data;
  },

  async inviteMember(payload: InviteMemberPayload): Promise<void> {
    await apiClient.post("/tenants/members", payload);
  },

  async updateTenant(payload: UpdateTenantPayload): Promise<TenantDetails> {
    const { data } = await apiClient.patch<TenantDetails>("/tenants", payload);
    return data;
  },

  async removeMember(memberId: string): Promise<{ success: boolean; isSelf?: boolean }> {
    const { data } = await apiClient.delete(`/tenants/members/${memberId}`);
    return data;
  },

  async updateMemberRole(
    memberId: string,
    payload: UpdateMemberRolePayload,
  ): Promise<{ success: boolean; noChange?: boolean }> {
    const { data } = await apiClient.patch(`/tenants/members/${memberId}`, payload);
    return data;
  },
};
