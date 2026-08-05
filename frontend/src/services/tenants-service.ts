import { apiClient } from "./api-client";
import type { TenantMember } from "@/types/billing";
import type { TenantRole } from "@/types/auth";
import type { BusinessHours } from "@/types/bots";

export interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  status: string;
  createdAt: string;
  timezone?: string;
  language?: string;
  businessHours?: BusinessHours | null;
  offlineMessage?: string | null;
  welcomeMessage?: string | null;
}

export interface TenantDetails {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  timezone: string;
  language: string;
}

export interface TenantSettings {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  timezone: string | null;
  language: string | null;
  businessHours: BusinessHours | null;
  offlineMessage: string | null;
  welcomeMessage: string | null;
}

export interface UpdateTenantSettingsPayload {
  name?: string;
  slug?: string;
  logo?: string | null;
  timezone?: string;
  language?: string;
  businessHours?: BusinessHours | null;
  offlineMessage?: string | null;
  welcomeMessage?: string | null;
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

export interface Invitation {
  id: string;
  email: string;
  roleName: TenantRole;
  status: string;
  createdAt: string;
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

  async listInvitations(): Promise<Invitation[]> {
    const { data } = await apiClient.get<Invitation[]>("/tenants/invitations");
    return data;
  },

  async cancelInvitation(invitationId: string): Promise<{ success: boolean }> {
    const { data } = await apiClient.delete(`/tenants/invitations/${invitationId}`);
    return data;
  },

  async updateTenant(payload: UpdateTenantPayload): Promise<TenantDetails> {
    const { data } = await apiClient.patch<TenantDetails>("/tenants", payload);
    return data;
  },

  async getSettings(): Promise<TenantSettings> {
    const { data } = await apiClient.get<TenantSettings>("/tenants/settings");
    return data;
  },

  async updateSettings(payload: UpdateTenantSettingsPayload): Promise<TenantSettings> {
    const { data } = await apiClient.patch<TenantSettings>("/tenants/settings", payload);
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

  async transferOwnership(
    newOwnerTenantUserId: string,
  ): Promise<{ success: boolean; noChange?: boolean }> {
    const { data } = await apiClient.post(`/tenants/transfer-ownership`, {
      newOwnerTenantUserId,
    });
    return data;
  },
};
