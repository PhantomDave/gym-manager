// Italian UI strings. The default language and the reference catalogue:
// `MessageKey` is derived from this object, so en.ts is a compile error until
// it carries every key here.
//
// `{name}` placeholders are interpolated by t(). A key ending in `_one`/`_other`
// is selected by Intl.PluralRules on `count`.
//
// House style: speak to the person at the desk. No jargon from the data model
// ("void", "archive"), no abbreviations, and every destructive action says what
// actually happens.

const it = {
  "app.name": "Gestione Palestra",

  // Navigation -------------------------------------------------------------
  "nav.today": "Oggi",
  "nav.members": "Iscritti",
  "nav.expiries": "Scadenze",
  "nav.settings": "Impostazioni",
  "nav.new_member": "Nuovo iscritto",

  // Today ------------------------------------------------------------------
  "today.title": "Oggi",
  "today.checkin": "Registra ingresso",
  "today.search_label": "Cerca la persona che sta entrando",
  "today.search_placeholder": "Scrivi il cognome e premi Invio",
  "today.no_match": "Nessun iscritto trovato per “{query}”.",
  "today.checked_in": "Entrati oggi",
  "today.nobody_yet": "Ancora nessun ingresso registrato.",
  "today.certs_expiring": "Certificati in scadenza",
  "today.no_certs_expiring": "Nessun certificato scade nei prossimi 30 giorni.",
  "today.admit": "Registra ingresso",
  "today.admit_anyway": "Fai entrare lo stesso",
  "today.open_card": "Apri scheda",
  "today.checked_in_ok": "Ingresso registrato.",
  "today.checked_in_override": "Ingresso registrato con deroga.",

  // Dashboard tiles --------------------------------------------------------
  "tile.active": "In regola",
  "tile.expiring": "In scadenza",
  "tile.expired": "Scaduti",
  "tile.cert_expired": "Certificato scaduto",
  "tile.cert_missing": "Certificato mancante",
  "tile.checkins": "Ingressi oggi",

  // Members ----------------------------------------------------------------
  "members.title": "Iscritti",
  "members.search_label": "Cerca fra gli iscritti",
  "members.search_placeholder": "Cognome o nome",
  "members.empty": "Nessun iscritto corrisponde a questo filtro.",
  "members.count_one": "{count} iscritto",
  "members.count_other": "{count} iscritti",

  "filter.all": "Tutti",
  "filter.active": "In regola",
  "filter.expiring": "In scadenza",
  "filter.expired": "Scaduti",
  "filter.certExpired": "Certificato scaduto",
  "filter.certMissing": "Certificato mancante",

  // Member card ------------------------------------------------------------
  "member.details": "Dati anagrafici",
  "member.certificate": "Certificato medico",
  "member.history": "Storico pagamenti",
  "member.documents": "Documenti",
  "member.no_certificate": "Nessun certificato depositato. La persona non può allenarsi.",
  "member.no_documents": "Nessun documento depositato.",
  "member.no_history": "Nessun pagamento registrato.",

  "member.renew": "Rinnova un mese",
  "member.add_cert": "Aggiorna certificato",
  "member.add_doc": "Aggiungi documento",
  "member.edit": "Modifica dati",
  "member.archive": "Togli dagli iscritti",

  "field.first_name": "Nome",
  "field.last_name": "Cognome",
  "field.national_id": "Codice fiscale",
  "field.birth_date": "Data di nascita",
  "field.phone": "Telefono",
  "field.email": "Email",
  "field.emergency_contact": "Chi chiamare in caso di emergenza",
  "field.emergency_phone": "Telefono per l'emergenza",
  "field.notes": "Note",
  "field.joined_on": "Iscritto dal",
  "field.issued_on": "Data di rilascio",
  "field.expires_on": "Data di scadenza",
  "field.issuer": "Medico o centro che l'ha rilasciato",
  "field.title": "Descrizione",
  "field.kind": "Tipo di documento",
  "field.price": "Quota",
  "field.paid": "Incassato adesso",
  "field.method": "Come ha pagato",
  "field.note": "Nota",
  "field.language": "Lingua",

  // Documents --------------------------------------------------------------
  "doc.health_cert": "Certificato medico",
  "doc.id_card": "Documento d'identità",
  "doc.waiver": "Liberatoria",
  "doc.contract": "Contratto",
  "doc.photo": "Foto",
  "doc.receipt": "Ricevuta",
  "doc.other": "Altro",
  "doc.choose_file": "Scegli il file da allegare",
  "doc.nothing_selected": "Nessun file scelto.",
  "doc.added": "Documento allegato.",
  "doc.removed": "Documento rimosso.",
  "doc.remove": "Rimuovi",
  "doc.open": "Apri",
  "doc.added_on": "allegato il {date}",
  "doc.expires_on_short": "scade il {date}",
  "doc.title_cert": "Aggiorna il certificato medico",
  "doc.title_other": "Allega un documento",
  "doc.register": "Allega",

  // Payment ----------------------------------------------------------------
  "pay.cash": "Contanti",
  "pay.card": "Bancomat o carta",
  "pay.transfer": "Bonifico",
  "pay.title": "Rinnovo mensile",
  "pay.stacks": "È ancora in regola, quindi il mese nuovo parte quando finisce quello in corso.",
  "pay.fresh": "Non è in regola, quindi il mese nuovo parte da oggi.",
  "pay.from": "Dal",
  "pay.to": "Al",
  "pay.take": "Registra il pagamento",
  "pay.done": "Rinnovo registrato.",
  "pay.owes": "deve ancora {amount}",
  "pay.cancelled": "annullato",
  "pay.cancel": "Annulla",
  "pay.cancel_title": "Annulla questo pagamento",
  "pay.cancel_why": "Perché va annullato?",
  "pay.cancel_hint":
    "Il pagamento resta visibile, barrato. Smette subito di valere come mese pagato.",
  "pay.cancel_placeholder": "es. inserito due volte per errore",
  "pay.cancelled_ok": "Pagamento annullato.",

  // Expiries ---------------------------------------------------------------
  "expiries.title": "Scadenze",
  "expiries.subtitle": "Chi va richiamato, in ordine di urgenza.",
  "expiries.memberships": "Abbonamento",
  "expiries.certificates": "Certificato medico",
  "expiries.window": "Mostra fino a",
  "expiries.window_7": "7 giorni",
  "expiries.window_30": "30 giorni",
  "expiries.window_90": "90 giorni",
  "expiries.none": "Niente in scadenza in questo periodo.",
  "expiries.overdue": "Già scaduti",
  "expiries.upcoming": "In arrivo",

  // Member form ------------------------------------------------------------
  "form.new_member": "Nuovo iscritto",
  "form.edit_member": "Modifica i dati di {name}",
  "form.create": "Crea",
  "form.save": "Salva",
  "form.cancel": "Annulla",
  "form.created": "Iscritto creato.",
  "form.saved": "Dati salvati.",
  // Inside parentheses after the label, so it need not agree in gender with
  // the noun: "Cognome (da compilare)", "Data di scadenza (da compilare)".
  "form.required": "da compilare",

  "archive.title": "Togliere {name} dagli iscritti?",
  "archive.hint":
    "Sparisce dall'elenco, ma pagamenti e documenti restano conservati. Da qui non si può annullare.",
  "archive.confirm": "Togli dagli iscritti",
  "archive.done": "Iscritto rimosso dall'elenco.",

  // Dates ------------------------------------------------------------------
  "date.day": "Giorno",
  "date.month": "Mese",
  "date.year": "Anno",
  "date.unset": "—",
  "month.1": "gennaio",
  "month.2": "febbraio",
  "month.3": "marzo",
  "month.4": "aprile",
  "month.5": "maggio",
  "month.6": "giugno",
  "month.7": "luglio",
  "month.8": "agosto",
  "month.9": "settembre",
  "month.10": "ottobre",
  "month.11": "novembre",
  "month.12": "dicembre",

  // Status badges ----------------------------------------------------------
  "status.paid_until": "In regola fino al {date}",
  "status.expired_on": "Scaduto il {date}",
  "status.no_membership": "Mai iscritto",
  "status.in_grace": "Scaduto da poco",
  "status.ends_today": "Finisce oggi",
  "status.days_left_one": "{count} giorno",
  "status.days_left_other": "{count} giorni",
  "status.cert_valid": "Certificato valido",
  "status.cert_expired": "Certificato scaduto",
  "status.cert_missing": "Certificato mancante",
  "status.cert_days_one": "Certificato: {count} giorno",
  "status.cert_days_other": "Certificato: {count} giorni",

  // Entry check (codes come from the backend) ------------------------------
  "entry.no_membership": "Non risulta nessun abbonamento.",
  "entry.membership_expired": "L'abbonamento è scaduto il {date}.",
  "entry.membership_grace":
    "L'abbonamento è scaduto il {date}, ma è ancora nei giorni di tolleranza.",
  "entry.membership_ending_one": "L'abbonamento finisce fra {days} giorno, il {date}.",
  "entry.membership_ending_other": "L'abbonamento finisce fra {days} giorni, il {date}.",
  "entry.no_certificate": "Non risulta nessun certificato medico.",
  "entry.certificate_expired": "Il certificato medico è scaduto il {date}.",
  "entry.certificate_ending_one": "Il certificato medico scade fra {days} giorno, il {date}.",
  "entry.certificate_ending_other": "Il certificato medico scade fra {days} giorni, il {date}.",
  "entry.override_title": "Fai entrare lo stesso",
  "entry.override_why": "Perché la fai entrare?",
  "entry.override_placeholder": "es. ha già preso appuntamento dal medico per venerdì",
  "entry.override_hint": "La motivazione resta registrata insieme all'ingresso.",
  "entry.override_confirm": "Fai entrare",

  // Settings ---------------------------------------------------------------
  "settings.title": "Impostazioni",
  "settings.gym_name": "Nome della palestra",
  "settings.currency": "Valuta",
  "settings.default_price": "Quota mensile",
  "settings.grace_days": "Giorni di tolleranza dopo la scadenza",
  "settings.expiry_warning_days": "Avvisa quanti giorni prima della scadenza dell'abbonamento",
  "settings.cert_warning_days": "Avvisa quanti giorni prima della scadenza del certificato",
  "settings.backup": "Copia di sicurezza",
  "settings.backup_hint":
    "Salva una copia della banca dati e tiene le ultime sette. I documenti stanno nella cartella docs/ e vanno copiati a parte su una chiavetta.",
  "settings.backup_now": "Fai una copia adesso",
  "settings.backup_done": "Copia salvata in {path}",

  // Errors (codes come from the backend) -----------------------------------
  "err.db.error":
    "Errore della banca dati. Riprova; se continua, fai una copia di sicurezza e chiedi aiuto.",
  "err.io.error": "Non riesco a leggere o scrivere il file.",
  "err.date.invalid": "La data inserita non è valida.",
  "err.member.not_found": "Questa persona non è più fra gli iscritti.",
  "err.member.name_required": "Servono sia il nome sia il cognome.",
  "err.member.duplicate_national_id": "C'è già un iscritto con questo codice fiscale.",
  "err.membership.not_found": "Il pagamento non esiste più o è già stato annullato.",
  "err.membership.overlap": "Questo periodo si sovrappone a un mese già pagato.",
  "err.membership.negative_price": "La quota non può essere negativa.",
  "err.membership.negative_paid": "L'importo incassato non può essere negativo.",
  "err.membership.void_reason_required": "Scrivi perché stai annullando il pagamento.",
  "err.document.not_found": "Il documento non esiste più.",
  "err.document.unknown_kind": "Tipo di documento non riconosciuto.",
  "err.document.cert_needs_expiry": "Il certificato medico ha bisogno della data di scadenza.",
  "err.document.expiry_before_issue": "La scadenza è precedente alla data di rilascio.",
  "err.document.open_failed":
    "Non riesco ad aprire il documento. Manca un programma per questo tipo di file?",
  "err.storage.file_not_found": "Il file scelto non esiste più.",
  "err.storage.not_a_file": "Quello che hai scelto non è un file.",
  "err.storage.file_empty": "Il file è vuoto.",
  "err.storage.file_too_large": "Il file pesa {size} MB, il massimo è {limit} MB.",
  "err.storage.file_missing": "Il file di questo documento non si trova più sul computer.",
  "err.storage.suspicious_path": "Percorso del documento non valido.",
  "err.storage.path_escape": "Percorso del documento non valido.",
  "err.checkin.blocked": "Per farla entrare devi scrivere una motivazione.",
  "err.backup.failed": "La copia di sicurezza non è riuscita.",
  "err.unknown": "Si è verificato un errore.",
} as const;

/** Every key the catalogue defines, including the `_one`/`_other` variants. */
export type CatalogueKey = keyof typeof it;

export default it;
