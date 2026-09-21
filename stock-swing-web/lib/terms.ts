import { supabaseAdmin } from './supabaseServer';

export type TermsDocument = {
  id: string;
  terms_type: string;
  version: string;
  title: string;
  body: string;
};

export async function getRequiredTerms(userId: string) {
  const supabase = supabaseAdmin();
  const document = await supabase
    .from('terms_documents')
    .select('id,terms_type,version,title,body')
    .eq('terms_type', 'service_terms')
    .eq('is_active', true)
    .single();
  if (document.error) throw new Error(`有効な利用規約を読み込めません: ${document.error.message}`);

  const terms = document.data as TermsDocument;
  const consent = await supabase
    .from('user_consents')
    .select('id,agreed_at')
    .eq('user_id', userId)
    .eq('consent_type', terms.terms_type)
    .eq('version', terms.version)
    .maybeSingle();
  if (consent.error) throw new Error(`規約同意状況を読み込めません: ${consent.error.message}`);
  return { document: terms, agreed: Boolean(consent.data) };
}

export async function hasRequiredTermsConsent(userId: string) {
  const state = await getRequiredTerms(userId);
  return state.agreed;
}

