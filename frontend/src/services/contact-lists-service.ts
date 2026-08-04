import { apiClient } from "./api-client";
import type {
  ContactList,
  ContactListDetail,
  CreateContactListPayload,
  AddContactsPayload,
} from "@/types/contact-lists";

export const contactListsService = {
  async list(): Promise<ContactList[]> {
    const { data } = await apiClient.get<ContactList[]>("/contact-lists");
    return data;
  },

  async getOne(id: string): Promise<ContactListDetail> {
    const { data } = await apiClient.get<ContactListDetail>(`/contact-lists/${id}`);
    return data;
  },

  async create(payload: CreateContactListPayload): Promise<ContactList> {
    const { data } = await apiClient.post<ContactList>("/contact-lists", payload);
    return data;
  },

  async remove(id: string): Promise<{ success: boolean }> {
    const { data } = await apiClient.delete<{ success: boolean }>(`/contact-lists/${id}`);
    return data;
  },

  async addContacts(id: string, payload: AddContactsPayload): Promise<{ added: number }> {
    const { data } = await apiClient.post<{ added: number }>(`/contact-lists/${id}/contacts`, payload);
    return data;
  },

  async removeContact(listId: string, contactId: string): Promise<{ success: boolean }> {
    const { data } = await apiClient.delete<{ success: boolean }>(`/contact-lists/${listId}/contacts/${contactId}`);
    return data;
  },
};