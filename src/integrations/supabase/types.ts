export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      affiliate_applications: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          city: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          internal_notes: string | null
          message: string | null
          partner_type: string
          phone: string
          referral_code: string | null
          referral_link: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          state: string | null
          status: string
          updated_at: string
          user_id: string | null
          works_with_rental: boolean | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          city?: string | null
          created_at?: string
          email: string
          full_name: string
          id?: string
          internal_notes?: string | null
          message?: string | null
          partner_type: string
          phone: string
          referral_code?: string | null
          referral_link?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          works_with_rental?: boolean | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          city?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          internal_notes?: string | null
          message?: string | null
          partner_type?: string
          phone?: string
          referral_code?: string | null
          referral_link?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          state?: string | null
          status?: string
          updated_at?: string
          user_id?: string | null
          works_with_rental?: boolean | null
        }
        Relationships: []
      }
      apolices: {
        Row: {
          consulta_id: string
          corretor_profile_id: string | null
          created_at: string
          id: string
          imobiliaria_profile_id: string | null
          numero: string
          proprietario_profile_id: string | null
          status: string
          updated_at: string
          valor_premio: number
          vigencia_fim: string
          vigencia_inicio: string
        }
        Insert: {
          consulta_id: string
          corretor_profile_id?: string | null
          created_at?: string
          id?: string
          imobiliaria_profile_id?: string | null
          numero: string
          proprietario_profile_id?: string | null
          status?: string
          updated_at?: string
          valor_premio: number
          vigencia_fim: string
          vigencia_inicio: string
        }
        Update: {
          consulta_id?: string
          corretor_profile_id?: string | null
          created_at?: string
          id?: string
          imobiliaria_profile_id?: string | null
          numero?: string
          proprietario_profile_id?: string | null
          status?: string
          updated_at?: string
          valor_premio?: number
          vigencia_fim?: string
          vigencia_inicio?: string
        }
        Relationships: [
          {
            foreignKeyName: "apolices_consulta_id_fkey"
            columns: ["consulta_id"]
            isOneToOne: false
            referencedRelation: "consultas_credito"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolices_corretor_profile_id_fkey"
            columns: ["corretor_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolices_corretor_profile_id_fkey"
            columns: ["corretor_profile_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "apolices_imobiliaria_profile_id_fkey"
            columns: ["imobiliaria_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolices_imobiliaria_profile_id_fkey"
            columns: ["imobiliaria_profile_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "apolices_proprietario_profile_id_fkey"
            columns: ["proprietario_profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "apolices_proprietario_profile_id_fkey"
            columns: ["proprietario_profile_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: string | null
          module: string
          new_value: Json | null
          old_value: Json | null
          performed_by: string | null
          target_id: string | null
          target_table: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: string | null
          module: string
          new_value?: Json | null
          old_value?: Json | null
          performed_by?: string | null
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: string | null
          module?: string
          new_value?: Json | null
          old_value?: Json | null
          performed_by?: string | null
          target_id?: string | null
          target_table?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_logs_performed_by_fkey"
            columns: ["performed_by"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      automacao_config: {
        Row: {
          chave: string
          descricao: string | null
          updated_at: string
          updated_by: string | null
          valor: Json
        }
        Insert: {
          chave: string
          descricao?: string | null
          updated_at?: string
          updated_by?: string | null
          valor: Json
        }
        Update: {
          chave?: string
          descricao?: string | null
          updated_at?: string
          updated_by?: string | null
          valor?: Json
        }
        Relationships: []
      }
      automacao_logs: {
        Row: {
          acao: string
          consulta_id: string | null
          cpf: string | null
          created_at: string
          detalhes: Json | null
          duration_ms: number | null
          error_message: string | null
          id: string
          resultado_credpago: string | null
          screenshot_url: string | null
          status: string
          worker_id: string | null
        }
        Insert: {
          acao: string
          consulta_id?: string | null
          cpf?: string | null
          created_at?: string
          detalhes?: Json | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          resultado_credpago?: string | null
          screenshot_url?: string | null
          status: string
          worker_id?: string | null
        }
        Update: {
          acao?: string
          consulta_id?: string | null
          cpf?: string | null
          created_at?: string
          detalhes?: Json | null
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          resultado_credpago?: string | null
          screenshot_url?: string | null
          status?: string
          worker_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "automacao_logs_consulta_id_fkey"
            columns: ["consulta_id"]
            isOneToOne: false
            referencedRelation: "consultas_credito"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_post_reactions: {
        Row: {
          dislike_count: number
          like_count: number
          post_slug: string
          updated_at: string
        }
        Insert: {
          dislike_count?: number
          like_count?: number
          post_slug: string
          updated_at?: string
        }
        Update: {
          dislike_count?: number
          like_count?: number
          post_slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      blog_post_votes: {
        Row: {
          created_at: string
          id: string
          post_slug: string
          session_id: string
          updated_at: string
          vote_type: string
        }
        Insert: {
          created_at?: string
          id?: string
          post_slug: string
          session_id: string
          updated_at?: string
          vote_type: string
        }
        Update: {
          created_at?: string
          id?: string
          post_slug?: string
          session_id?: string
          updated_at?: string
          vote_type?: string
        }
        Relationships: []
      }
      cargo_permissoes: {
        Row: {
          cargo_id: string
          created_at: string
          id: string
          permissao_id: string
        }
        Insert: {
          cargo_id: string
          created_at?: string
          id?: string
          permissao_id: string
        }
        Update: {
          cargo_id?: string
          created_at?: string
          id?: string
          permissao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cargo_permissoes_cargo_id_fkey"
            columns: ["cargo_id"]
            isOneToOne: false
            referencedRelation: "cargos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cargo_permissoes_permissao_id_fkey"
            columns: ["permissao_id"]
            isOneToOne: false
            referencedRelation: "permissoes"
            referencedColumns: ["id"]
          },
        ]
      }
      cargos_admin: {
        Row: {
          ativo: boolean
          chave: string
          created_at: string
          descricao: string | null
          id: string
          is_sistema: boolean
          nome: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          chave: string
          created_at?: string
          descricao?: string | null
          id?: string
          is_sistema?: boolean
          nome: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          chave?: string
          created_at?: string
          descricao?: string | null
          id?: string
          is_sistema?: boolean
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      comissoes: {
        Row: {
          beneficiario_id: string
          beneficiario_tipo: string
          contrato_id: string
          created_at: string | null
          disponivel_em: string | null
          id: string
          nivel_aplicado: string
          observacoes: string | null
          percentual_aplicado: number | null
          sacada_em: string | null
          solicitacao_saque_id: string | null
          status: string | null
          tipo_comissao: string
          valor: number
        }
        Insert: {
          beneficiario_id: string
          beneficiario_tipo: string
          contrato_id: string
          created_at?: string | null
          disponivel_em?: string | null
          id?: string
          nivel_aplicado: string
          observacoes?: string | null
          percentual_aplicado?: number | null
          sacada_em?: string | null
          solicitacao_saque_id?: string | null
          status?: string | null
          tipo_comissao: string
          valor: number
        }
        Update: {
          beneficiario_id?: string
          beneficiario_tipo?: string
          contrato_id?: string
          created_at?: string | null
          disponivel_em?: string | null
          id?: string
          nivel_aplicado?: string
          observacoes?: string | null
          percentual_aplicado?: number | null
          sacada_em?: string | null
          solicitacao_saque_id?: string | null
          status?: string | null
          tipo_comissao?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "comissoes_beneficiario_id_fkey"
            columns: ["beneficiario_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "comissoes_beneficiario_id_fkey"
            columns: ["beneficiario_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "comissoes_contrato_id_fkey"
            columns: ["contrato_id"]
            isOneToOne: false
            referencedRelation: "apolices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_comissoes_saque"
            columns: ["solicitacao_saque_id"]
            isOneToOne: false
            referencedRelation: "solicitacoes_saque"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes_sistema: {
        Row: {
          atualizado_em: string | null
          chave: string
          descricao: string | null
          valor: string
        }
        Insert: {
          atualizado_em?: string | null
          chave: string
          descricao?: string | null
          valor: string
        }
        Update: {
          atualizado_em?: string | null
          chave?: string
          descricao?: string | null
          valor?: string
        }
        Relationships: []
      }
      consulta_inquilinos: {
        Row: {
          consulta_id: string
          created_at: string
          documento_cifrado: string
          documento_mascarado: string
          id: string
          nome: string | null
          tipo_pessoa: string
        }
        Insert: {
          consulta_id: string
          created_at?: string
          documento_cifrado: string
          documento_mascarado: string
          id?: string
          nome?: string | null
          tipo_pessoa: string
        }
        Update: {
          consulta_id?: string
          created_at?: string
          documento_cifrado?: string
          documento_mascarado?: string
          id?: string
          nome?: string | null
          tipo_pessoa?: string
        }
        Relationships: [
          {
            foreignKeyName: "consulta_inquilinos_consulta_id_fkey"
            columns: ["consulta_id"]
            isOneToOne: false
            referencedRelation: "consultas_credito_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      consulta_logs: {
        Row: {
          acao: string
          consulta_id: string
          created_at: string
          id: string
          ip: string | null
          metadata: Json | null
          status_anterior: string | null
          status_novo: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          acao: string
          consulta_id: string
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          status_anterior?: string | null
          status_novo?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          acao?: string
          consulta_id?: string
          created_at?: string
          id?: string
          ip?: string | null
          metadata?: Json | null
          status_anterior?: string | null
          status_novo?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "consulta_logs_consulta_id_fkey"
            columns: ["consulta_id"]
            isOneToOne: false
            referencedRelation: "consultas_credito_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      consultas: {
        Row: {
          corretor_id: string | null
          created_at: string
          id: string
          locatario_cpf: string
          locatario_nome: string
          mensagem_erro: string | null
          plano: string
          resultado_payload: Json | null
          status: string
          tentativas: number
          updated_at: string
          valor_locaticio: number
        }
        Insert: {
          corretor_id?: string | null
          created_at?: string
          id?: string
          locatario_cpf: string
          locatario_nome: string
          mensagem_erro?: string | null
          plano: string
          resultado_payload?: Json | null
          status?: string
          tentativas?: number
          updated_at?: string
          valor_locaticio: number
        }
        Update: {
          corretor_id?: string | null
          created_at?: string
          id?: string
          locatario_cpf?: string
          locatario_nome?: string
          mensagem_erro?: string | null
          plano?: string
          resultado_payload?: Json | null
          status?: string
          tentativas?: number
          updated_at?: string
          valor_locaticio?: number
        }
        Relationships: [
          {
            foreignKeyName: "consultas_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultas_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      consultas_credito: {
        Row: {
          accepted_ip: string | null
          accepted_user_agent: string | null
          activation_completed_at: string | null
          activation_cpf_attempts: number
          activation_fee_amount: number | null
          activation_fee_commission: number | null
          activation_fee_enabled: boolean | null
          activation_last_access_at: string | null
          activation_status: string | null
          activation_token: string | null
          activation_token_expires_at: string | null
          approved_at: string | null
          approved_by: string | null
          automacao_attempts: number
          automacao_credpago_resultado: Json | null
          automacao_credpago_status: string | null
          automacao_last_error: string | null
          automacao_origem: string | null
          automacao_processed_at: string | null
          base_calculo: number | null
          billing_responsible_role: string | null
          billing_responsible_user_id: string | null
          biometria_image_url: string | null
          biometria_sent_at: string | null
          biometria_status: string | null
          commission_enabled: boolean | null
          contract_accepted: boolean | null
          contract_accepted_at: string | null
          corretor_id: string | null
          created_at: string
          dados_complementares_em: string | null
          documentos: Json | null
          external_error: string | null
          external_history: Json
          external_painting_enabled: boolean | null
          external_painting_installment: number | null
          external_painting_total: number | null
          external_provider: string | null
          external_request_id: string | null
          external_response: Json | null
          external_status: string | null
          id: string
          imovel_bairro: string | null
          imovel_cep: string | null
          imovel_cidade: string | null
          imovel_complemento: string | null
          imovel_endereco: string | null
          imovel_estado: string | null
          imovel_id: string
          imovel_numero: string | null
          imovel_subtipo: string | null
          inquilino_id: string
          insurance_assistance: string | null
          insurance_commission_pct: number | null
          insurance_coverages: Json | null
          insurance_payment_method: string | null
          insurance_payment_method_label: string | null
          insurance_restriction_warning_acknowledged: boolean | null
          internal_notes: string | null
          link_ativacao_enviado_em: string | null
          observacoes: string | null
          origem: string | null
          payment_confirmed_at: string | null
          payment_status: string | null
          payment_type: string | null
          plano_id: string | null
          profile_id_solicitante: string | null
          property_address: string | null
          property_not_wood_confirmed: boolean | null
          proposal_summary: Json | null
          proposta_enviada_em: string | null
          provider_returned_at: string | null
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          rent_value: number | null
          role_solicitante: string | null
          score_interno: number | null
          selected_exit_cost: number | null
          sent_to_provider_at: string | null
          status: string
          substatus: string | null
          tenant_data_nascimento: string | null
          tenant_document: string | null
          tenant_email: string | null
          tenant_name: string | null
          tenant_telefone: string | null
          tenant_type: string | null
          tenant_user_id: string | null
          terms_accepted: boolean | null
          terms_accepted_at: string | null
          updated_at: string
          valor_anual: number | null
          valor_premio_mensal: number | null
        }
        Insert: {
          accepted_ip?: string | null
          accepted_user_agent?: string | null
          activation_completed_at?: string | null
          activation_cpf_attempts?: number
          activation_fee_amount?: number | null
          activation_fee_commission?: number | null
          activation_fee_enabled?: boolean | null
          activation_last_access_at?: string | null
          activation_status?: string | null
          activation_token?: string | null
          activation_token_expires_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          automacao_attempts?: number
          automacao_credpago_resultado?: Json | null
          automacao_credpago_status?: string | null
          automacao_last_error?: string | null
          automacao_origem?: string | null
          automacao_processed_at?: string | null
          base_calculo?: number | null
          billing_responsible_role?: string | null
          billing_responsible_user_id?: string | null
          biometria_image_url?: string | null
          biometria_sent_at?: string | null
          biometria_status?: string | null
          commission_enabled?: boolean | null
          contract_accepted?: boolean | null
          contract_accepted_at?: string | null
          corretor_id?: string | null
          created_at?: string
          dados_complementares_em?: string | null
          documentos?: Json | null
          external_error?: string | null
          external_history?: Json
          external_painting_enabled?: boolean | null
          external_painting_installment?: number | null
          external_painting_total?: number | null
          external_provider?: string | null
          external_request_id?: string | null
          external_response?: Json | null
          external_status?: string | null
          id?: string
          imovel_bairro?: string | null
          imovel_cep?: string | null
          imovel_cidade?: string | null
          imovel_complemento?: string | null
          imovel_endereco?: string | null
          imovel_estado?: string | null
          imovel_id: string
          imovel_numero?: string | null
          imovel_subtipo?: string | null
          inquilino_id: string
          insurance_assistance?: string | null
          insurance_commission_pct?: number | null
          insurance_coverages?: Json | null
          insurance_payment_method?: string | null
          insurance_payment_method_label?: string | null
          insurance_restriction_warning_acknowledged?: boolean | null
          internal_notes?: string | null
          link_ativacao_enviado_em?: string | null
          observacoes?: string | null
          origem?: string | null
          payment_confirmed_at?: string | null
          payment_status?: string | null
          payment_type?: string | null
          plano_id?: string | null
          profile_id_solicitante?: string | null
          property_address?: string | null
          property_not_wood_confirmed?: boolean | null
          proposal_summary?: Json | null
          proposta_enviada_em?: string | null
          provider_returned_at?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          rent_value?: number | null
          role_solicitante?: string | null
          score_interno?: number | null
          selected_exit_cost?: number | null
          sent_to_provider_at?: string | null
          status?: string
          substatus?: string | null
          tenant_data_nascimento?: string | null
          tenant_document?: string | null
          tenant_email?: string | null
          tenant_name?: string | null
          tenant_telefone?: string | null
          tenant_type?: string | null
          tenant_user_id?: string | null
          terms_accepted?: boolean | null
          terms_accepted_at?: string | null
          updated_at?: string
          valor_anual?: number | null
          valor_premio_mensal?: number | null
        }
        Update: {
          accepted_ip?: string | null
          accepted_user_agent?: string | null
          activation_completed_at?: string | null
          activation_cpf_attempts?: number
          activation_fee_amount?: number | null
          activation_fee_commission?: number | null
          activation_fee_enabled?: boolean | null
          activation_last_access_at?: string | null
          activation_status?: string | null
          activation_token?: string | null
          activation_token_expires_at?: string | null
          approved_at?: string | null
          approved_by?: string | null
          automacao_attempts?: number
          automacao_credpago_resultado?: Json | null
          automacao_credpago_status?: string | null
          automacao_last_error?: string | null
          automacao_origem?: string | null
          automacao_processed_at?: string | null
          base_calculo?: number | null
          billing_responsible_role?: string | null
          billing_responsible_user_id?: string | null
          biometria_image_url?: string | null
          biometria_sent_at?: string | null
          biometria_status?: string | null
          commission_enabled?: boolean | null
          contract_accepted?: boolean | null
          contract_accepted_at?: string | null
          corretor_id?: string | null
          created_at?: string
          dados_complementares_em?: string | null
          documentos?: Json | null
          external_error?: string | null
          external_history?: Json
          external_painting_enabled?: boolean | null
          external_painting_installment?: number | null
          external_painting_total?: number | null
          external_provider?: string | null
          external_request_id?: string | null
          external_response?: Json | null
          external_status?: string | null
          id?: string
          imovel_bairro?: string | null
          imovel_cep?: string | null
          imovel_cidade?: string | null
          imovel_complemento?: string | null
          imovel_endereco?: string | null
          imovel_estado?: string | null
          imovel_id?: string
          imovel_numero?: string | null
          imovel_subtipo?: string | null
          inquilino_id?: string
          insurance_assistance?: string | null
          insurance_commission_pct?: number | null
          insurance_coverages?: Json | null
          insurance_payment_method?: string | null
          insurance_payment_method_label?: string | null
          insurance_restriction_warning_acknowledged?: boolean | null
          internal_notes?: string | null
          link_ativacao_enviado_em?: string | null
          observacoes?: string | null
          origem?: string | null
          payment_confirmed_at?: string | null
          payment_status?: string | null
          payment_type?: string | null
          plano_id?: string | null
          profile_id_solicitante?: string | null
          property_address?: string | null
          property_not_wood_confirmed?: boolean | null
          proposal_summary?: Json | null
          proposta_enviada_em?: string | null
          provider_returned_at?: string | null
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          rent_value?: number | null
          role_solicitante?: string | null
          score_interno?: number | null
          selected_exit_cost?: number | null
          sent_to_provider_at?: string | null
          status?: string
          substatus?: string | null
          tenant_data_nascimento?: string | null
          tenant_document?: string | null
          tenant_email?: string | null
          tenant_name?: string | null
          tenant_telefone?: string | null
          tenant_type?: string | null
          tenant_user_id?: string | null
          terms_accepted?: boolean | null
          terms_accepted_at?: string | null
          updated_at?: string
          valor_anual?: number | null
          valor_premio_mensal?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "consultas_credito_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultas_credito_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "consultas_credito_corretor_id_fkey"
            columns: ["corretor_id"]
            isOneToOne: false
            referencedRelation: "corretores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultas_credito_imovel_id_fkey"
            columns: ["imovel_id"]
            isOneToOne: false
            referencedRelation: "imoveis"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultas_credito_inquilino_id_fkey"
            columns: ["inquilino_id"]
            isOneToOne: false
            referencedRelation: "inquilinos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultas_credito_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultas_credito_profile_id_solicitante_fkey"
            columns: ["profile_id_solicitante"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultas_credito_profile_id_solicitante_fkey"
            columns: ["profile_id_solicitante"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "consultas_credito_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "consultas_credito_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      consultas_credito_v2: {
        Row: {
          aluguel: number
          available_assistances_json: Json | null
          available_plans_json: Json | null
          cargo_solicitante: string
          cep: string
          commercial_premium: number | null
          condominio: number
          consent_at: string | null
          consent_lgpd: boolean
          created_at: string
          dados_cotacao: Json | null
          erro_interno: string | null
          gross_premium: number | null
          id: string
          imobiliaria_id: string | null
          installments: number | null
          iof: number | null
          payment_type: string | null
          policy_id: string | null
          policy_number: string | null
          processed_at: string | null
          proposal_id: string | null
          protocolo_externo: string | null
          provedor: string | null
          provider_environment: string | null
          quote_id: string | null
          quote_number: string | null
          request_payload_sanitized: Json | null
          response_payload_sanitized: Json | null
          selected_assistance: string | null
          selected_plan: string | null
          status: string
          status_pottencial: string | null
          taxas: number
          tenant_approved_limit: number | null
          tipo_imovel: string
          underwriting_status: string | null
          updated_at: string
          user_id: string
          valor_aprovado: number | null
        }
        Insert: {
          aluguel: number
          available_assistances_json?: Json | null
          available_plans_json?: Json | null
          cargo_solicitante: string
          cep: string
          commercial_premium?: number | null
          condominio?: number
          consent_at?: string | null
          consent_lgpd?: boolean
          created_at?: string
          dados_cotacao?: Json | null
          erro_interno?: string | null
          gross_premium?: number | null
          id?: string
          imobiliaria_id?: string | null
          installments?: number | null
          iof?: number | null
          payment_type?: string | null
          policy_id?: string | null
          policy_number?: string | null
          processed_at?: string | null
          proposal_id?: string | null
          protocolo_externo?: string | null
          provedor?: string | null
          provider_environment?: string | null
          quote_id?: string | null
          quote_number?: string | null
          request_payload_sanitized?: Json | null
          response_payload_sanitized?: Json | null
          selected_assistance?: string | null
          selected_plan?: string | null
          status?: string
          status_pottencial?: string | null
          taxas?: number
          tenant_approved_limit?: number | null
          tipo_imovel: string
          underwriting_status?: string | null
          updated_at?: string
          user_id: string
          valor_aprovado?: number | null
        }
        Update: {
          aluguel?: number
          available_assistances_json?: Json | null
          available_plans_json?: Json | null
          cargo_solicitante?: string
          cep?: string
          commercial_premium?: number | null
          condominio?: number
          consent_at?: string | null
          consent_lgpd?: boolean
          created_at?: string
          dados_cotacao?: Json | null
          erro_interno?: string | null
          gross_premium?: number | null
          id?: string
          imobiliaria_id?: string | null
          installments?: number | null
          iof?: number | null
          payment_type?: string | null
          policy_id?: string | null
          policy_number?: string | null
          processed_at?: string | null
          proposal_id?: string | null
          protocolo_externo?: string | null
          provedor?: string | null
          provider_environment?: string | null
          quote_id?: string | null
          quote_number?: string | null
          request_payload_sanitized?: Json | null
          response_payload_sanitized?: Json | null
          selected_assistance?: string | null
          selected_plan?: string | null
          status?: string
          status_pottencial?: string | null
          taxas?: number
          tenant_approved_limit?: number | null
          tipo_imovel?: string
          underwriting_status?: string | null
          updated_at?: string
          user_id?: string
          valor_aprovado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "consultas_credito_v2_imobiliaria_id_fkey"
            columns: ["imobiliaria_id"]
            isOneToOne: false
            referencedRelation: "imobiliarias"
            referencedColumns: ["id"]
          },
        ]
      }
      consultas_log: {
        Row: {
          consulta_id: string
          created_at: string
          detalhe: Json | null
          etapa: string
          id: string
        }
        Insert: {
          consulta_id: string
          created_at?: string
          detalhe?: Json | null
          etapa: string
          id?: string
        }
        Update: {
          consulta_id?: string
          created_at?: string
          detalhe?: Json | null
          etapa?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "consultas_log_consulta_id_fkey"
            columns: ["consulta_id"]
            isOneToOne: false
            referencedRelation: "consultas"
            referencedColumns: ["id"]
          },
        ]
      }
      corretores: {
        Row: {
          cidade: string | null
          comissao_pct: number | null
          cpf: string | null
          created_at: string
          creci: string | null
          estado: string | null
          id: string
          imobiliaria_id: string | null
          pix: string | null
          profile_id: string
          susep: string | null
          updated_at: string
          vinculado_imobiliaria: boolean | null
        }
        Insert: {
          cidade?: string | null
          comissao_pct?: number | null
          cpf?: string | null
          created_at?: string
          creci?: string | null
          estado?: string | null
          id?: string
          imobiliaria_id?: string | null
          pix?: string | null
          profile_id: string
          susep?: string | null
          updated_at?: string
          vinculado_imobiliaria?: boolean | null
        }
        Update: {
          cidade?: string | null
          comissao_pct?: number | null
          cpf?: string | null
          created_at?: string
          creci?: string | null
          estado?: string | null
          id?: string
          imobiliaria_id?: string | null
          pix?: string | null
          profile_id?: string
          susep?: string | null
          updated_at?: string
          vinculado_imobiliaria?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "corretores_imobiliaria_id_fkey"
            columns: ["imobiliaria_id"]
            isOneToOne: false
            referencedRelation: "imobiliarias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corretores_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "corretores_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      credpago_credentials: {
        Row: {
          active: boolean
          cookies: Json | null
          created_at: string
          created_by: string | null
          id: string
          imobiliaria_id: string | null
          label: string
          last_login_at: string | null
          last_used_at: string | null
          notes: string | null
          password_cifrada: string
          updated_at: string
          username: string
        }
        Insert: {
          active?: boolean
          cookies?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          imobiliaria_id?: string | null
          label: string
          last_login_at?: string | null
          last_used_at?: string | null
          notes?: string | null
          password_cifrada: string
          updated_at?: string
          username: string
        }
        Update: {
          active?: boolean
          cookies?: Json | null
          created_at?: string
          created_by?: string | null
          id?: string
          imobiliaria_id?: string | null
          label?: string
          last_login_at?: string | null
          last_used_at?: string | null
          notes?: string | null
          password_cifrada?: string
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "credpago_credentials_imobiliaria_id_fkey"
            columns: ["imobiliaria_id"]
            isOneToOne: false
            referencedRelation: "imobiliarias"
            referencedColumns: ["id"]
          },
        ]
      }
      dados_financeiros_recebimento: {
        Row: {
          bank_name: string
          created_at: string
          financial_data_status: string
          id: string
          pix_key: string
          pix_key_normalized: string
          pix_key_type: string
          receiver_full_name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          bank_name: string
          created_at?: string
          financial_data_status?: string
          id?: string
          pix_key: string
          pix_key_normalized: string
          pix_key_type: string
          receiver_full_name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          bank_name?: string
          created_at?: string
          financial_data_status?: string
          id?: string
          pix_key?: string
          pix_key_normalized?: string
          pix_key_type?: string
          receiver_full_name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      documentos_contrato: {
        Row: {
          apolice_id: string
          created_at: string
          file_name: string | null
          file_url: string | null
          id: string
          status: string
          storage_path: string | null
          tipo: string
          updated_at: string
          uploaded_at: string | null
        }
        Insert: {
          apolice_id: string
          created_at?: string
          file_name?: string | null
          file_url?: string | null
          id?: string
          status?: string
          storage_path?: string | null
          tipo: string
          updated_at?: string
          uploaded_at?: string | null
        }
        Update: {
          apolice_id?: string
          created_at?: string
          file_name?: string | null
          file_url?: string | null
          id?: string
          status?: string
          storage_path?: string | null
          tipo?: string
          updated_at?: string
          uploaded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_contrato_apolice_id_fkey"
            columns: ["apolice_id"]
            isOneToOne: false
            referencedRelation: "apolices"
            referencedColumns: ["id"]
          },
        ]
      }
      documentos_proposta: {
        Row: {
          apolice_id: string | null
          consulta_id: string | null
          created_at: string
          document_subtype: string | null
          document_type: string | null
          file_name: string
          file_type: string | null
          file_url: string
          id: string
          tenant_user_id: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          apolice_id?: string | null
          consulta_id?: string | null
          created_at?: string
          document_subtype?: string | null
          document_type?: string | null
          file_name: string
          file_type?: string | null
          file_url: string
          id?: string
          tenant_user_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          apolice_id?: string | null
          consulta_id?: string | null
          created_at?: string
          document_subtype?: string | null
          document_type?: string | null
          file_name?: string
          file_type?: string | null
          file_url?: string
          id?: string
          tenant_user_id?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documentos_proposta_apolice_id_fkey"
            columns: ["apolice_id"]
            isOneToOne: false
            referencedRelation: "apolices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documentos_proposta_consulta_id_fkey"
            columns: ["consulta_id"]
            isOneToOne: false
            referencedRelation: "consultas_credito"
            referencedColumns: ["id"]
          },
        ]
      }
      eventos_funil: {
        Row: {
          created_at: string | null
          evento: string
          id: string
          metadata: Json | null
          origem: string | null
          profile_id: string | null
          sessao_id: string | null
        }
        Insert: {
          created_at?: string | null
          evento: string
          id?: string
          metadata?: Json | null
          origem?: string | null
          profile_id?: string | null
          sessao_id?: string | null
        }
        Update: {
          created_at?: string | null
          evento?: string
          id?: string
          metadata?: Json | null
          origem?: string | null
          profile_id?: string | null
          sessao_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "eventos_funil_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eventos_funil_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      faturas_inquilino: {
        Row: {
          apolice_id: string | null
          boleto_url: string | null
          consulta_id: string | null
          created_at: string
          id: string
          linha_digitavel: string | null
          numero_parcela: number
          pago_em: string | null
          status: string
          tenant_user_id: string
          updated_at: string
          valor: number
          vencimento: string
        }
        Insert: {
          apolice_id?: string | null
          boleto_url?: string | null
          consulta_id?: string | null
          created_at?: string
          id?: string
          linha_digitavel?: string | null
          numero_parcela: number
          pago_em?: string | null
          status?: string
          tenant_user_id: string
          updated_at?: string
          valor: number
          vencimento: string
        }
        Update: {
          apolice_id?: string | null
          boleto_url?: string | null
          consulta_id?: string | null
          created_at?: string
          id?: string
          linha_digitavel?: string | null
          numero_parcela?: number
          pago_em?: string | null
          status?: string
          tenant_user_id?: string
          updated_at?: string
          valor?: number
          vencimento?: string
        }
        Relationships: [
          {
            foreignKeyName: "faturas_inquilino_apolice_id_fkey"
            columns: ["apolice_id"]
            isOneToOne: false
            referencedRelation: "apolices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "faturas_inquilino_consulta_id_fkey"
            columns: ["consulta_id"]
            isOneToOne: false
            referencedRelation: "consultas_credito"
            referencedColumns: ["id"]
          },
        ]
      }
      imobiliarias: {
        Row: {
          cargo: string | null
          cidade: string | null
          cnpj: string
          comissao_pct: number | null
          contato_email: string | null
          contato_nome: string | null
          contato_telefone: string | null
          created_at: string
          creci: string
          endereco: string | null
          estado: string | null
          id: string
          nome_fantasia: string | null
          razao_social: string
          updated_at: string
        }
        Insert: {
          cargo?: string | null
          cidade?: string | null
          cnpj: string
          comissao_pct?: number | null
          contato_email?: string | null
          contato_nome?: string | null
          contato_telefone?: string | null
          created_at?: string
          creci: string
          endereco?: string | null
          estado?: string | null
          id?: string
          nome_fantasia?: string | null
          razao_social: string
          updated_at?: string
        }
        Update: {
          cargo?: string | null
          cidade?: string | null
          cnpj?: string
          comissao_pct?: number | null
          contato_email?: string | null
          contato_nome?: string | null
          contato_telefone?: string | null
          created_at?: string
          creci?: string
          endereco?: string | null
          estado?: string | null
          id?: string
          nome_fantasia?: string | null
          razao_social?: string
          updated_at?: string
        }
        Relationships: []
      }
      imoveis: {
        Row: {
          bairro: string | null
          cep: string | null
          cidade: string | null
          complemento: string | null
          created_at: string
          encargos: number | null
          endereco: string | null
          estado: string | null
          id: string
          imobiliaria_id: string | null
          logradouro: string | null
          numero: string | null
          proprietario_id: string | null
          tipo: string
          updated_at: string
          valor_aluguel: number
          valor_condominio: number | null
          valor_taxas: number | null
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          created_at?: string
          encargos?: number | null
          endereco?: string | null
          estado?: string | null
          id?: string
          imobiliaria_id?: string | null
          logradouro?: string | null
          numero?: string | null
          proprietario_id?: string | null
          tipo: string
          updated_at?: string
          valor_aluguel: number
          valor_condominio?: number | null
          valor_taxas?: number | null
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          complemento?: string | null
          created_at?: string
          encargos?: number | null
          endereco?: string | null
          estado?: string | null
          id?: string
          imobiliaria_id?: string | null
          logradouro?: string | null
          numero?: string | null
          proprietario_id?: string | null
          tipo?: string
          updated_at?: string
          valor_aluguel?: number
          valor_condominio?: number | null
          valor_taxas?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "imoveis_imobiliaria_id_fkey"
            columns: ["imobiliaria_id"]
            isOneToOne: false
            referencedRelation: "imobiliarias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imoveis_proprietario_id_fkey"
            columns: ["proprietario_id"]
            isOneToOne: false
            referencedRelation: "proprietarios"
            referencedColumns: ["id"]
          },
        ]
      }
      inquilinos: {
        Row: {
          cnpj: string | null
          cpf: string
          created_at: string
          data_nascimento: string | null
          estado_civil: string | null
          id: string
          nome: string
          profile_id: string | null
          profissao: string | null
          razao_social: string | null
          renda: number | null
          rg: string | null
          score: number | null
          tipo: string | null
          updated_at: string
        }
        Insert: {
          cnpj?: string | null
          cpf: string
          created_at?: string
          data_nascimento?: string | null
          estado_civil?: string | null
          id?: string
          nome: string
          profile_id?: string | null
          profissao?: string | null
          razao_social?: string | null
          renda?: number | null
          rg?: string | null
          score?: number | null
          tipo?: string | null
          updated_at?: string
        }
        Update: {
          cnpj?: string | null
          cpf?: string
          created_at?: string
          data_nascimento?: string | null
          estado_civil?: string | null
          id?: string
          nome?: string
          profile_id?: string | null
          profissao?: string | null
          razao_social?: string | null
          renda?: number | null
          rg?: string | null
          score?: number | null
          tipo?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inquilinos_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inquilinos_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      internal_audit_logs: {
        Row: {
          action: string
          actor_role: string | null
          actor_user_id: string | null
          after: Json | null
          before: Json | null
          created_at: string
          id: string
          record_id: string | null
          table_name: string | null
        }
        Insert: {
          action: string
          actor_role?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          record_id?: string | null
          table_name?: string | null
        }
        Update: {
          action?: string
          actor_role?: string | null
          actor_user_id?: string | null
          after?: Json | null
          before?: Json | null
          created_at?: string
          id?: string
          record_id?: string | null
          table_name?: string | null
        }
        Relationships: []
      }
      internal_users: {
        Row: {
          auth_user_id: string
          created_at: string
          email: string
          full_name: string
          id: string
          phone: string | null
          role: Database["public"]["Enums"]["internal_role"]
          status: Database["public"]["Enums"]["internal_user_status"]
          updated_at: string
        }
        Insert: {
          auth_user_id: string
          created_at?: string
          email: string
          full_name: string
          id?: string
          phone?: string | null
          role: Database["public"]["Enums"]["internal_role"]
          status?: Database["public"]["Enums"]["internal_user_status"]
          updated_at?: string
        }
        Update: {
          auth_user_id?: string
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          phone?: string | null
          role?: Database["public"]["Enums"]["internal_role"]
          status?: Database["public"]["Enums"]["internal_user_status"]
          updated_at?: string
        }
        Relationships: []
      }
      job_applications: {
        Row: {
          area_interest: string | null
          city: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          internal_notes: string | null
          job_id: string | null
          linkedin_url: string | null
          message: string | null
          phone: string
          resume_file_name: string
          resume_file_path: string
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          state: string | null
          status: string
          updated_at: string
        }
        Insert: {
          area_interest?: string | null
          city?: string | null
          created_at?: string
          email: string
          full_name: string
          id?: string
          internal_notes?: string | null
          job_id?: string | null
          linkedin_url?: string | null
          message?: string | null
          phone: string
          resume_file_name: string
          resume_file_path: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          state?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          area_interest?: string | null
          city?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          internal_notes?: string | null
          job_id?: string | null
          linkedin_url?: string | null
          message?: string | null
          phone?: string
          resume_file_name?: string
          resume_file_path?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          state?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_applications_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "job_openings"
            referencedColumns: ["id"]
          },
        ]
      }
      job_openings: {
        Row: {
          area: string
          benefits: string | null
          city: string | null
          contract_type: string | null
          created_at: string
          created_by: string | null
          description: string
          id: string
          published_at: string | null
          requirements: string | null
          state: string | null
          status: string
          title: string
          updated_at: string
          work_model: string
        }
        Insert: {
          area: string
          benefits?: string | null
          city?: string | null
          contract_type?: string | null
          created_at?: string
          created_by?: string | null
          description: string
          id?: string
          published_at?: string | null
          requirements?: string | null
          state?: string | null
          status?: string
          title: string
          updated_at?: string
          work_model: string
        }
        Update: {
          area?: string
          benefits?: string | null
          city?: string | null
          contract_type?: string | null
          created_at?: string
          created_by?: string | null
          description?: string
          id?: string
          published_at?: string | null
          requirements?: string | null
          state?: string | null
          status?: string
          title?: string
          updated_at?: string
          work_model?: string
        }
        Relationships: []
      }
      leads: {
        Row: {
          cidade: string
          cnpj_creci: string | null
          created_at: string
          email: string
          id: string
          nome: string
          perfil: string
          telefone: string
          updated_at: string
        }
        Insert: {
          cidade: string
          cnpj_creci?: string | null
          created_at?: string
          email: string
          id?: string
          nome: string
          perfil: string
          telefone: string
          updated_at?: string
        }
        Update: {
          cidade?: string
          cnpj_creci?: string | null
          created_at?: string
          email?: string
          id?: string
          nome?: string
          perfil?: string
          telefone?: string
          updated_at?: string
        }
        Relationships: []
      }
      leads_contato: {
        Row: {
          area_interesse: string | null
          cidade: string
          contatado_em: string | null
          convertido_em: string | null
          created_at: string | null
          email: string
          id: string
          mensagem: string | null
          nome: string
          observacoes_internas: string | null
          origem: string | null
          perfil: string
          referral_code: string | null
          responsavel_id: string | null
          status: string | null
          telefone: string
          uf: string
        }
        Insert: {
          area_interesse?: string | null
          cidade: string
          contatado_em?: string | null
          convertido_em?: string | null
          created_at?: string | null
          email: string
          id?: string
          mensagem?: string | null
          nome: string
          observacoes_internas?: string | null
          origem?: string | null
          perfil: string
          referral_code?: string | null
          responsavel_id?: string | null
          status?: string | null
          telefone: string
          uf: string
        }
        Update: {
          area_interesse?: string | null
          cidade?: string
          contatado_em?: string | null
          convertido_em?: string | null
          created_at?: string | null
          email?: string
          id?: string
          mensagem?: string | null
          nome?: string
          observacoes_internas?: string | null
          origem?: string | null
          perfil?: string
          referral_code?: string | null
          responsavel_id?: string | null
          status?: string | null
          telefone?: string
          uf?: string
        }
        Relationships: [
          {
            foreignKeyName: "leads_contato_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_contato_responsavel_id_fkey"
            columns: ["responsavel_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      mensalidades: {
        Row: {
          apolice_id: string
          boleto_url: string | null
          codigo_barras: string | null
          comprovante_url: string | null
          created_at: string | null
          data_pagamento: string | null
          data_vencimento: string
          id: string
          linha_digitavel: string | null
          numero_parcela: number | null
          status: string | null
          valor: number
        }
        Insert: {
          apolice_id: string
          boleto_url?: string | null
          codigo_barras?: string | null
          comprovante_url?: string | null
          created_at?: string | null
          data_pagamento?: string | null
          data_vencimento: string
          id?: string
          linha_digitavel?: string | null
          numero_parcela?: number | null
          status?: string | null
          valor: number
        }
        Update: {
          apolice_id?: string
          boleto_url?: string | null
          codigo_barras?: string | null
          comprovante_url?: string | null
          created_at?: string | null
          data_pagamento?: string | null
          data_vencimento?: string
          id?: string
          linha_digitavel?: string | null
          numero_parcela?: number | null
          status?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "mensalidades_apolice_id_fkey"
            columns: ["apolice_id"]
            isOneToOne: false
            referencedRelation: "apolices"
            referencedColumns: ["id"]
          },
        ]
      }
      niveis_perfil: {
        Row: {
          ativo: boolean | null
          bonus_renovacao: number | null
          cor_hex: string | null
          created_at: string | null
          id: string
          max_contratos: number | null
          min_contratos: number
          nome_nivel: string
          ordem: number
          percentual_comissao: number | null
          tipo_perfil: string
        }
        Insert: {
          ativo?: boolean | null
          bonus_renovacao?: number | null
          cor_hex?: string | null
          created_at?: string | null
          id?: string
          max_contratos?: number | null
          min_contratos: number
          nome_nivel: string
          ordem: number
          percentual_comissao?: number | null
          tipo_perfil: string
        }
        Update: {
          ativo?: boolean | null
          bonus_renovacao?: number | null
          cor_hex?: string | null
          created_at?: string | null
          id?: string
          max_contratos?: number | null
          min_contratos?: number
          nome_nivel?: string
          ordem?: number
          percentual_comissao?: number | null
          tipo_perfil?: string
        }
        Relationships: []
      }
      notificacoes: {
        Row: {
          cor_destaque: string | null
          created_at: string
          icone: string | null
          id: string
          lida: boolean | null
          lida_em: string | null
          link: string | null
          mensagem: string
          tipo: string | null
          titulo: string
          user_id: string | null
        }
        Insert: {
          cor_destaque?: string | null
          created_at?: string
          icone?: string | null
          id?: string
          lida?: boolean | null
          lida_em?: string | null
          link?: string | null
          mensagem: string
          tipo?: string | null
          titulo: string
          user_id?: string | null
        }
        Update: {
          cor_destaque?: string | null
          created_at?: string
          icone?: string | null
          id?: string
          lida?: boolean | null
          lida_em?: string | null
          link?: string | null
          mensagem?: string
          tipo?: string | null
          titulo?: string
          user_id?: string | null
        }
        Relationships: []
      }
      permissoes: {
        Row: {
          acao: string
          chave: string
          created_at: string
          descricao: string | null
          id: string
          modulo: string
        }
        Insert: {
          acao: string
          chave: string
          created_at?: string
          descricao?: string | null
          id?: string
          modulo: string
        }
        Update: {
          acao?: string
          chave?: string
          created_at?: string
          descricao?: string | null
          id?: string
          modulo?: string
        }
        Relationships: []
      }
      planos: {
        Row: {
          ativo: boolean | null
          cobertura_multiplicador: number | null
          cobre_taxas_condominio: boolean | null
          comissao_meses: number | null
          created_at: string
          custo_saida: number | null
          destaque: string | null
          id: string
          nome: string
          ordem: number | null
          taxa_premio: number
          tem_comissao: boolean | null
        }
        Insert: {
          ativo?: boolean | null
          cobertura_multiplicador?: number | null
          cobre_taxas_condominio?: boolean | null
          comissao_meses?: number | null
          created_at?: string
          custo_saida?: number | null
          destaque?: string | null
          id?: string
          nome: string
          ordem?: number | null
          taxa_premio: number
          tem_comissao?: boolean | null
        }
        Update: {
          ativo?: boolean | null
          cobertura_multiplicador?: number | null
          cobre_taxas_condominio?: boolean | null
          comissao_meses?: number | null
          created_at?: string
          custo_saida?: number | null
          destaque?: string | null
          id?: string
          nome?: string
          ordem?: number | null
          taxa_premio?: number
          tem_comissao?: boolean | null
        }
        Relationships: []
      }
      pottencial_config: {
        Row: {
          beneficiary_cellphone: string | null
          beneficiary_document: string | null
          beneficiary_email: string | null
          beneficiary_endereco: Json | null
          beneficiary_name: string | null
          beneficiary_tipo_pessoa: string | null
          broker_commission_percentage: number | null
          broker_document: string | null
          created_at: string
          default_assistance: string | null
          default_inhabited: boolean | null
          default_installments: number | null
          default_multiple: number | null
          default_payment_type: string | null
          default_plan: string | null
          default_vigencia_meses: number | null
          id: string
          insured_cellphone: string | null
          insured_document: string | null
          insured_email: string | null
          insured_endereco: Json | null
          insured_name: string | null
          insured_tipo_pessoa: string | null
          insured_use_beneficiary: boolean | null
          policy_owner_document: string | null
          sandbox_property_complement: string | null
          sandbox_property_number: string | null
          sandbox_tenant_cellphone: string | null
          sandbox_tenant_email: string | null
          sandbox_tenant_name: string | null
          singleton: boolean
          updated_at: string
        }
        Insert: {
          beneficiary_cellphone?: string | null
          beneficiary_document?: string | null
          beneficiary_email?: string | null
          beneficiary_endereco?: Json | null
          beneficiary_name?: string | null
          beneficiary_tipo_pessoa?: string | null
          broker_commission_percentage?: number | null
          broker_document?: string | null
          created_at?: string
          default_assistance?: string | null
          default_inhabited?: boolean | null
          default_installments?: number | null
          default_multiple?: number | null
          default_payment_type?: string | null
          default_plan?: string | null
          default_vigencia_meses?: number | null
          id?: string
          insured_cellphone?: string | null
          insured_document?: string | null
          insured_email?: string | null
          insured_endereco?: Json | null
          insured_name?: string | null
          insured_tipo_pessoa?: string | null
          insured_use_beneficiary?: boolean | null
          policy_owner_document?: string | null
          sandbox_property_complement?: string | null
          sandbox_property_number?: string | null
          sandbox_tenant_cellphone?: string | null
          sandbox_tenant_email?: string | null
          sandbox_tenant_name?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Update: {
          beneficiary_cellphone?: string | null
          beneficiary_document?: string | null
          beneficiary_email?: string | null
          beneficiary_endereco?: Json | null
          beneficiary_name?: string | null
          beneficiary_tipo_pessoa?: string | null
          broker_commission_percentage?: number | null
          broker_document?: string | null
          created_at?: string
          default_assistance?: string | null
          default_inhabited?: boolean | null
          default_installments?: number | null
          default_multiple?: number | null
          default_payment_type?: string | null
          default_plan?: string | null
          default_vigencia_meses?: number | null
          id?: string
          insured_cellphone?: string | null
          insured_document?: string | null
          insured_email?: string | null
          insured_endereco?: Json | null
          insured_name?: string | null
          insured_tipo_pessoa?: string | null
          insured_use_beneficiary?: boolean | null
          policy_owner_document?: string | null
          sandbox_property_complement?: string | null
          sandbox_property_number?: string | null
          sandbox_tenant_cellphone?: string | null
          sandbox_tenant_email?: string | null
          sandbox_tenant_name?: string | null
          singleton?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          avatar_url: string | null
          contratos_ativos_count: number | null
          created_at: string
          email: string
          id: string
          motivo_reprovacao: string | null
          nivel_atual: string | null
          nivel_atualizado_em: string | null
          nome: string
          referral_code: string | null
          referred_at: string | null
          referred_by_code: string | null
          referred_by_user_id: string | null
          role: Database["public"]["Enums"]["user_role"]
          status: string | null
          telefone: string | null
          updated_at: string
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          avatar_url?: string | null
          contratos_ativos_count?: number | null
          created_at?: string
          email: string
          id: string
          motivo_reprovacao?: string | null
          nivel_atual?: string | null
          nivel_atualizado_em?: string | null
          nome: string
          referral_code?: string | null
          referred_at?: string | null
          referred_by_code?: string | null
          referred_by_user_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          avatar_url?: string | null
          contratos_ativos_count?: number | null
          created_at?: string
          email?: string
          id?: string
          motivo_reprovacao?: string | null
          nivel_atual?: string | null
          nivel_atualizado_em?: string | null
          nome?: string
          referral_code?: string | null
          referred_at?: string | null
          referred_by_code?: string | null
          referred_by_user_id?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          status?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "profiles_referred_by_user_id_fkey"
            columns: ["referred_by_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profiles_referred_by_user_id_fkey"
            columns: ["referred_by_user_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      proposta_historico: {
        Row: {
          consulta_id: string
          created_at: string
          created_by: string | null
          descricao: string
          id: string
          metadata: Json | null
          tipo_evento: string
        }
        Insert: {
          consulta_id: string
          created_at?: string
          created_by?: string | null
          descricao: string
          id?: string
          metadata?: Json | null
          tipo_evento: string
        }
        Update: {
          consulta_id?: string
          created_at?: string
          created_by?: string | null
          descricao?: string
          id?: string
          metadata?: Json | null
          tipo_evento?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposta_historico_consulta_id_fkey"
            columns: ["consulta_id"]
            isOneToOne: false
            referencedRelation: "consultas_credito"
            referencedColumns: ["id"]
          },
        ]
      }
      proprietarios: {
        Row: {
          banco_dados: Json | null
          cpf_cnpj: string
          created_at: string
          email: string | null
          id: string
          nome: string
          profile_id: string | null
          telefone: string | null
          updated_at: string
        }
        Insert: {
          banco_dados?: Json | null
          cpf_cnpj: string
          created_at?: string
          email?: string | null
          id?: string
          nome: string
          profile_id?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          banco_dados?: Json | null
          cpf_cnpj?: string
          created_at?: string
          email?: string | null
          id?: string
          nome?: string
          profile_id?: string | null
          telefone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "proprietarios_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proprietarios_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      referral_rewards: {
        Row: {
          amount: number
          available_at: string | null
          created_at: string
          id: string
          paid_at: string | null
          referral_id: string
          source_type: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          available_at?: string | null
          created_at?: string
          id?: string
          paid_at?: string | null
          referral_id: string
          source_type?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          available_at?: string | null
          created_at?: string
          id?: string
          paid_at?: string | null
          referral_id?: string
          source_type?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referral_rewards_referral_id_fkey"
            columns: ["referral_id"]
            isOneToOne: false
            referencedRelation: "referrals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referral_rewards_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      referrals: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          first_contract_at: string | null
          first_contract_id: string | null
          fraud_reasons: Json | null
          fraud_status: string
          id: string
          internal_notes: string | null
          paid_at: string | null
          referral_code: string
          referred_document: string | null
          referred_email: string | null
          referred_phone: string | null
          referred_role: string | null
          referred_user_id: string | null
          referrer_role: string | null
          referrer_user_id: string
          rejected_at: string | null
          rejected_by: string | null
          rejection_reason: string | null
          reward_amount: number
          reward_status: string
          signup_at: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          first_contract_at?: string | null
          first_contract_id?: string | null
          fraud_reasons?: Json | null
          fraud_status?: string
          id?: string
          internal_notes?: string | null
          paid_at?: string | null
          referral_code: string
          referred_document?: string | null
          referred_email?: string | null
          referred_phone?: string | null
          referred_role?: string | null
          referred_user_id?: string | null
          referrer_role?: string | null
          referrer_user_id: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reward_amount?: number
          reward_status?: string
          signup_at?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          first_contract_at?: string | null
          first_contract_id?: string | null
          fraud_reasons?: Json | null
          fraud_status?: string
          id?: string
          internal_notes?: string | null
          paid_at?: string | null
          referral_code?: string
          referred_document?: string | null
          referred_email?: string | null
          referred_phone?: string | null
          referred_role?: string | null
          referred_user_id?: string | null
          referrer_role?: string | null
          referrer_user_id?: string
          rejected_at?: string | null
          rejected_by?: string | null
          rejection_reason?: string | null
          reward_amount?: number
          reward_status?: string
          signup_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "referrals_first_contract_id_fkey"
            columns: ["first_contract_id"]
            isOneToOne: false
            referencedRelation: "apolices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referred_user_id_fkey"
            columns: ["referred_user_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "referrals_referrer_user_id_fkey"
            columns: ["referrer_user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_referrer_user_id_fkey"
            columns: ["referrer_user_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "referrals_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_rejected_by_fkey"
            columns: ["rejected_by"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          can_approve: boolean
          can_create: boolean
          can_delete: boolean
          can_edit: boolean
          can_view: boolean
          created_at: string
          id: string
          module: string
          role: Database["public"]["Enums"]["internal_role"]
          updated_at: string
        }
        Insert: {
          can_approve?: boolean
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          module: string
          role: Database["public"]["Enums"]["internal_role"]
          updated_at?: string
        }
        Update: {
          can_approve?: boolean
          can_create?: boolean
          can_delete?: boolean
          can_edit?: boolean
          can_view?: boolean
          created_at?: string
          id?: string
          module?: string
          role?: Database["public"]["Enums"]["internal_role"]
          updated_at?: string
        }
        Relationships: []
      }
      sales_leads: {
        Row: {
          assigned_seller_id: string | null
          city: string | null
          converted_consulta_id: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          interest: string | null
          next_action_at: string | null
          notes: string | null
          origin: string | null
          phone: string | null
          status: string
          type: string | null
          updated_at: string
        }
        Insert: {
          assigned_seller_id?: string | null
          city?: string | null
          converted_consulta_id?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          interest?: string | null
          next_action_at?: string | null
          notes?: string | null
          origin?: string | null
          phone?: string | null
          status?: string
          type?: string | null
          updated_at?: string
        }
        Update: {
          assigned_seller_id?: string | null
          city?: string | null
          converted_consulta_id?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          interest?: string | null
          next_action_at?: string | null
          notes?: string | null
          origin?: string | null
          phone?: string | null
          status?: string
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_leads_assigned_seller_id_fkey"
            columns: ["assigned_seller_id"]
            isOneToOne: false
            referencedRelation: "internal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      sales_materials: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          id: string
          tags: string[] | null
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          id?: string
          tags?: string[] | null
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          id?: string
          tags?: string[] | null
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      seller_appointments: {
        Row: {
          created_at: string
          id: string
          lead_id: string | null
          notes: string | null
          priority: string
          reminder_minutes: number | null
          scheduled_at: string
          seller_id: string
          status: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          priority?: string
          reminder_minutes?: number | null
          scheduled_at: string
          seller_id: string
          status?: string
          title: string
          type?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          lead_id?: string | null
          notes?: string | null
          priority?: string
          reminder_minutes?: number | null
          scheduled_at?: string
          seller_id?: string
          status?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "seller_appointments_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "sales_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_appointments_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "internal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_commissions: {
        Row: {
          apolice_id: string | null
          bonus_amount: number
          canceled_at: string | null
          clawback_applied_at: string | null
          clawback_reason: string | null
          clawback_until: string | null
          commission_amount: number
          contract_id: string | null
          created_at: string
          eligible_at: string | null
          id: string
          mensalidade_id: string | null
          month: number
          released_amount: number
          released_at: string | null
          reserve_amount: number
          reserve_release_at: string | null
          seller_id: string
          status: string
          updated_at: string
          year: number
        }
        Insert: {
          apolice_id?: string | null
          bonus_amount?: number
          canceled_at?: string | null
          clawback_applied_at?: string | null
          clawback_reason?: string | null
          clawback_until?: string | null
          commission_amount?: number
          contract_id?: string | null
          created_at?: string
          eligible_at?: string | null
          id?: string
          mensalidade_id?: string | null
          month: number
          released_amount?: number
          released_at?: string | null
          reserve_amount?: number
          reserve_release_at?: string | null
          seller_id: string
          status?: string
          updated_at?: string
          year: number
        }
        Update: {
          apolice_id?: string | null
          bonus_amount?: number
          canceled_at?: string | null
          clawback_applied_at?: string | null
          clawback_reason?: string | null
          clawback_until?: string | null
          commission_amount?: number
          contract_id?: string | null
          created_at?: string
          eligible_at?: string | null
          id?: string
          mensalidade_id?: string | null
          month?: number
          released_amount?: number
          released_at?: string | null
          reserve_amount?: number
          reserve_release_at?: string | null
          seller_id?: string
          status?: string
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "seller_commissions_apolice_id_fkey"
            columns: ["apolice_id"]
            isOneToOne: false
            referencedRelation: "apolices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_commissions_mensalidade_id_fkey"
            columns: ["mensalidade_id"]
            isOneToOne: false
            referencedRelation: "mensalidades"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "seller_commissions_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "internal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_goals: {
        Row: {
          created_at: string
          id: string
          month: number
          seller_id: string
          target_contracts: number
          updated_at: string
          year: number
        }
        Insert: {
          created_at?: string
          id?: string
          month: number
          seller_id: string
          target_contracts?: number
          updated_at?: string
          year: number
        }
        Update: {
          created_at?: string
          id?: string
          month?: number
          seller_id?: string
          target_contracts?: number
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "seller_goals_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "internal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      seller_performance: {
        Row: {
          bonus_bloqueado: boolean
          bonus_total: number
          commission_total: number
          contracts_activated: number
          contracts_canceled: number
          contracts_closed: number
          created_at: string
          generated_revenue_ltv: number
          id: string
          immediate_revenue: number
          month: number
          seller_id: string
          total_estimated_gain: number
          updated_at: string
          year: number
        }
        Insert: {
          bonus_bloqueado?: boolean
          bonus_total?: number
          commission_total?: number
          contracts_activated?: number
          contracts_canceled?: number
          contracts_closed?: number
          created_at?: string
          generated_revenue_ltv?: number
          id?: string
          immediate_revenue?: number
          month: number
          seller_id: string
          total_estimated_gain?: number
          updated_at?: string
          year: number
        }
        Update: {
          bonus_bloqueado?: boolean
          bonus_total?: number
          commission_total?: number
          contracts_activated?: number
          contracts_canceled?: number
          contracts_closed?: number
          created_at?: string
          generated_revenue_ltv?: number
          id?: string
          immediate_revenue?: number
          month?: number
          seller_id?: string
          total_estimated_gain?: number
          updated_at?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "seller_performance_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "internal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      sinistros: {
        Row: {
          apolice_id: string
          created_at: string
          id: string
          motivo: string | null
          profile_id: string
          status: string
          updated_at: string
          valor_estimado: number | null
        }
        Insert: {
          apolice_id: string
          created_at?: string
          id?: string
          motivo?: string | null
          profile_id: string
          status?: string
          updated_at?: string
          valor_estimado?: number | null
        }
        Update: {
          apolice_id?: string
          created_at?: string
          id?: string
          motivo?: string | null
          profile_id?: string
          status?: string
          updated_at?: string
          valor_estimado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sinistros_apolice_id_fkey"
            columns: ["apolice_id"]
            isOneToOne: false
            referencedRelation: "apolices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistros_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sinistros_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      solicitacoes_saque: {
        Row: {
          aprovado_em: string | null
          aprovado_por: string | null
          comprovante_url: string | null
          created_at: string | null
          id: string
          motivo_rejeicao: string | null
          observacoes_internas: string | null
          pago_em: string | null
          pago_por: string | null
          perfil_tipo: string
          pix_chave: string
          pix_tipo: string
          profile_id: string
          status: string | null
          taxa_saque: number
          valor_bruto: number
          valor_liquido: number
        }
        Insert: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          comprovante_url?: string | null
          created_at?: string | null
          id?: string
          motivo_rejeicao?: string | null
          observacoes_internas?: string | null
          pago_em?: string | null
          pago_por?: string | null
          perfil_tipo: string
          pix_chave: string
          pix_tipo: string
          profile_id: string
          status?: string | null
          taxa_saque?: number
          valor_bruto: number
          valor_liquido: number
        }
        Update: {
          aprovado_em?: string | null
          aprovado_por?: string | null
          comprovante_url?: string | null
          created_at?: string | null
          id?: string
          motivo_rejeicao?: string | null
          observacoes_internas?: string | null
          pago_em?: string | null
          pago_por?: string | null
          perfil_tipo?: string
          pix_chave?: string
          pix_tipo?: string
          profile_id?: string
          status?: string | null
          taxa_saque?: number
          valor_bruto?: number
          valor_liquido?: number
        }
        Relationships: [
          {
            foreignKeyName: "solicitacoes_saque_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacoes_saque_aprovado_por_fkey"
            columns: ["aprovado_por"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "solicitacoes_saque_pago_por_fkey"
            columns: ["pago_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacoes_saque_pago_por_fkey"
            columns: ["pago_por"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "solicitacoes_saque_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "solicitacoes_saque_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      support_tickets: {
        Row: {
          assigned_to: string | null
          created_at: string
          description: string | null
          forwarded_to: Database["public"]["Enums"]["internal_role"] | null
          id: string
          priority: string
          resolution: string | null
          status: string
          subject: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          forwarded_to?: Database["public"]["Enums"]["internal_role"] | null
          id?: string
          priority?: string
          resolution?: string | null
          status?: string
          subject: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          assigned_to?: string | null
          created_at?: string
          description?: string | null
          forwarded_to?: Database["public"]["Enums"]["internal_role"] | null
          id?: string
          priority?: string
          resolution?: string | null
          status?: string
          subject?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "support_tickets_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "internal_users"
            referencedColumns: ["id"]
          },
        ]
      }
      usuarios_internos: {
        Row: {
          cargo_id: string
          created_at: string
          criado_por: string | null
          id: string
          observacoes: string | null
          profile_id: string
          status: string
          updated_at: string
        }
        Insert: {
          cargo_id: string
          created_at?: string
          criado_por?: string | null
          id?: string
          observacoes?: string | null
          profile_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          cargo_id?: string
          created_at?: string
          criado_por?: string | null
          id?: string
          observacoes?: string | null
          profile_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usuarios_internos_cargo_id_fkey"
            columns: ["cargo_id"]
            isOneToOne: false
            referencedRelation: "cargos_admin"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usuarios_internos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usuarios_internos_criado_por_fkey"
            columns: ["criado_por"]
            isOneToOne: false
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "usuarios_internos_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usuarios_internos_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "saldos_comissao"
            referencedColumns: ["profile_id"]
          },
        ]
      }
      verificacoes_documento: {
        Row: {
          created_at: string
          document_back_url: string | null
          document_front_url: string | null
          document_type: string
          id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewer_id: string | null
          selfie_url: string | null
          submitted_at: string | null
          updated_at: string
          user_id: string
          verification_status: string
        }
        Insert: {
          created_at?: string
          document_back_url?: string | null
          document_front_url?: string | null
          document_type: string
          id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          selfie_url?: string | null
          submitted_at?: string | null
          updated_at?: string
          user_id: string
          verification_status?: string
        }
        Update: {
          created_at?: string
          document_back_url?: string | null
          document_front_url?: string | null
          document_type?: string
          id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewer_id?: string | null
          selfie_url?: string | null
          submitted_at?: string | null
          updated_at?: string
          user_id?: string
          verification_status?: string
        }
        Relationships: []
      }
    }
    Views: {
      saldos_comissao: {
        Row: {
          nome: string | null
          profile_id: string | null
          saldo_disponivel: number | null
          saldo_pendente: number | null
          tipo_perfil: Database["public"]["Enums"]["user_role"] | null
          total_acumulado: number | null
          total_sacado: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      aplicar_clawback_vendedor: { Args: never; Returns: number }
      atualizar_niveis_diariamente: { Args: never; Returns: undefined }
      calcular_bonus_vendedor: { Args: { contratos: number }; Returns: number }
      calcular_comissao_vendedor: {
        Args: { contratos: number }
        Returns: number
      }
      current_imobiliaria_id: { Args: never; Returns: string }
      decrypt_credpago: {
        Args: { _cifrado: string; _key: string }
        Returns: string
      }
      decrypt_documento: {
        Args: { _inquilino_id: string; _key: string }
        Returns: string
      }
      decrypt_documento_worker: {
        Args: { _inquilino_id: string; _key: string }
        Returns: string
      }
      encrypt_credpago: {
        Args: { _key: string; _plain: string }
        Returns: string
      }
      encrypt_documento: {
        Args: { _doc: string; _key: string }
        Returns: string
      }
      ensure_nox_demo_auth_user: {
        Args: {
          p_email: string
          p_nome: string
          p_password: string
          p_role: Database["public"]["Enums"]["user_role"]
          p_telefone?: string
        }
        Returns: string
      }
      finalizar_consultas_travadas: { Args: never; Returns: number }
      find_corretor: {
        Args: { p_by: string; p_query: string }
        Returns: {
          corretor_id: string
          cpf: string
          creci: string
          email: string
          imobiliaria_id: string
          nome: string
          profile_id: string
          status: string
          telefone: string
        }[]
      }
      generate_referral_code: { Args: { _profile_id: string }; Returns: string }
      get_internal_role: {
        Args: { _uid: string }
        Returns: Database["public"]["Enums"]["internal_role"]
      }
      get_nivel_corretor_info: {
        Args: { p_corretor_id: string }
        Returns: {
          contratos_ativos: number
          nivel_cor: string
          nivel_icone: string
          nivel_nome: string
          nivel_percentual: number
          proximo_nivel_min: number
          proximo_nivel_nome: string
        }[]
      }
      has_internal_role: {
        Args: {
          _role: Database["public"]["Enums"]["internal_role"]
          _uid: string
        }
        Returns: boolean
      }
      has_permission: {
        Args: { _permission_key: string; _user_id: string }
        Returns: boolean
      }
      has_role: { Args: { _role: string; _user_id: string }; Returns: boolean }
      internal_user_id: { Args: { _uid: string }; Returns: string }
      is_admin: { Args: { _uid: string }; Returns: boolean }
      is_internal: { Args: { _uid: string }; Returns: boolean }
      liberar_reservas_vendedor: { Args: never; Returns: number }
      listar_propostas_pendentes_automacao: {
        Args: { _limit?: number }
        Returns: {
          attempts: number
          consulta_id: string
          cpf: string
          created_at: string
          credential_id: string
          credpago_username: string
          email: string
          imobiliaria_id: string
          nome: string
          property_address: string
          rent_value: number
        }[]
      }
      materializar_comissoes_vendedor: {
        Args: { p_ano?: number; p_mes?: number }
        Returns: number
      }
      resetar_consulta_para_reprocessar: {
        Args: { _consulta_id: string }
        Returns: undefined
      }
      validar_ativacao_token: {
        Args: { _cpf: string; _token: string }
        Returns: Json
      }
    }
    Enums: {
      internal_role:
        | "admin_master"
        | "juridico"
        | "financeiro"
        | "marketing"
        | "suporte"
        | "vendedor"
      internal_user_status: "ativo" | "bloqueado" | "pendente"
      user_role:
        | "admin"
        | "analista"
        | "financeiro"
        | "corretor"
        | "imobiliaria"
        | "proprietario"
        | "inquilino"
        | "comercial"
        | "admin_master"
        | "juridico"
        | "marketing"
        | "suporte"
        | "vendedor"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      internal_role: [
        "admin_master",
        "juridico",
        "financeiro",
        "marketing",
        "suporte",
        "vendedor",
      ],
      internal_user_status: ["ativo", "bloqueado", "pendente"],
      user_role: [
        "admin",
        "analista",
        "financeiro",
        "corretor",
        "imobiliaria",
        "proprietario",
        "inquilino",
        "comercial",
        "admin_master",
        "juridico",
        "marketing",
        "suporte",
        "vendedor",
      ],
    },
  },
} as const
