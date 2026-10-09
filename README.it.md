<div align="center">

# Mockxy Skills

[![en](lang-eng.svg)](README.md)
[![it](lang-ita.svg)](README.it.md)

**Skill per agenti AI che creano mock nel formato dei workspace [Mockxy](https://github.com/tosdan/mockxy).**

![Licenza MIT](https://img.shields.io/badge/licenza-MIT-blue)
![Agent Skills](https://img.shields.io/badge/agent%20skills-4-7c9d8e)

</div>

---

Indicando a un agente il percorso di un workspace Mockxy, l'agente sa comporre endpoint, varianti
di risposta, handler, middleware e stream perfettamente conformi a ciò che il motore carica.

Il catalogo segue la [specifica aperta Agent Skills](https://agentskills.io/specification) ed è
installabile tramite il [CLI `skills`](https://github.com/vercel-labs/skills).

## Installazione

```sh
npx skills@latest add tosdan/mockxy-skills --skill '*' --global
```

È il modo consigliato: `--skill '*'` installa tutte e quattro le skill del catalogo, `--global` le
rende disponibili a livello utente anziché nel solo progetto corrente. Skill e ambito sono già
scelti, quindi il CLI chiede soltanto **per quali agenti** installarle.

Le quattro skill sono pensate per lavorare insieme e un endpoint completo nasce quasi sempre da
due di esse (vedi [Come si combinano](#come-si-combinano)): installarle tutte evita che l'agente
si trovi con metà del formato.

## Altre opzioni

Il comando `skills add` riceve come argomento la sorgente da cui scoprire e installare le skill:
un repository GitHub, un URL Git o una cartella locale. La sorgente GitHub di questo catalogo è
`tosdan/mockxy-skills`.

### Esplorare il catalogo senza installare

```sh
npx skills@latest add tosdan/mockxy-skills --list
```

### Installare solo nel progetto corrente

Basta togliere `--global`:

```sh
npx skills@latest add tosdan/mockxy-skills --skill '*'
```

### Installare una skill specifica

```sh
npx skills@latest add tosdan/mockxy-skills --skill mockxy-workspace --global
```

### Installare la versione corrispondente al motore

La sorgente `tosdan/mockxy-skills` installa le skill di `main`, che possono già descrivere
funzioni della prossima release di Mockxy (segnalate come "newer engines" nei riferimenti). Per
allinearle a un motore rilasciato, installa dalla tag con la stessa versione: ogni release di
Mockxy dalla 1.4.2 in poi ha una tag `vX.Y.Z` anche qui.

```sh
npx skills@latest add https://github.com/tosdan/mockxy-skills/tree/v1.4.2 --skill '*' --global
```

Il motore in esecuzione riporta la sua versione in `GET /_admin/api/info`. Per cambiare versione,
ripeti lo stesso comando con un'altra tag.

### Indicare l'agente sulla riga di comando

`--agent` salta anche la domanda sugli agenti:

```sh
npx skills@latest add tosdan/mockxy-skills --skill '*' --global --agent claude-code
```

Altri identificativi supportati includono, per esempio, `codex`, `cursor` e `opencode`.

### Installazione non interattiva

`--yes` accetta automaticamente le conferme residue. È utile negli script e nei flussi in cui
skill, agente e ambito sono già stati scelti esplicitamente:

```sh
npx skills@latest add tosdan/mockxy-skills --skill '*' --global --agent codex --yes
```

### Usare un checkout locale

Dalla radice di questo repository, usare `.` come sorgente:

```sh
# Elenca le skill locali senza installarle
npx skills@latest add . --list

# Installa il catalogo locale
npx skills@latest add . --skill '*' --global
```

## Catalogo

Tutte le skill usano il prefisso `mockxy-`: è lo spazio dei nomi del catalogo e serve a non
entrare in conflitto con skill installate da altre sorgenti.

### `mockxy-workspace`

La skill di ingresso. Riconosce e inizializza un workspace, conosce la struttura delle cartelle e
il formato del **file endpoint** (metodo, percorso, varianti disponibili e variante selezionata),
la selezione delle response sequence, la convenzione dei percorsi, l'organizzazione del catalogo
in collezioni e l'admin API.
Include `scripts/validate-workspace.js`, il validatore che ricalca i controlli del motore Mockxy.

```text
Usa $mockxy-workspace per ispezionare il workspace in D:\progetti\mio-workspace, aggiungere
l'endpoint GET /api/ordini/:id e validare il risultato.
```

### `mockxy-static-mock`

Varianti di risposta statiche: status, header, body JSON o testuale, payload binari da file,
ritardo simulato, templating dei placeholder `{{...}}` e varianti `sequence` selezionabili che
fanno evolvere la risposta nel tempo. Copre anche i filtri e la paginazione automatici sulle liste.

```text
Usa $mockxy-static-mock per creare l'endpoint GET /api/utenti con tre varianti: lista piena,
lista vuota e errore 500.
```

### `mockxy-dynamic-mock`

Handler e middleware: script JavaScript locali che calcolano la risposta o trasformano quella del
backend reale, più file dati JSON letti tramite `data()` e stato runtime nominato condiviso fra
handler. Copre scenari in cui una POST deve cambiare una GET successiva prima che esista il backend.

```text
Usa $mockxy-dynamic-mock per scrivere un handler su GET /api/utenti/:id che cerca l'utente nel
file dati e risponde 404 quando non esiste.
```

```text
Usa $mockxy-dynamic-mock per fare in modo che POST /api/items aggiunga dati arbitrari del frontend
allo stato runtime condiviso e che GET /api/items restituisca il seed più ogni item aggiunto.
```

### `mockxy-realtime-mock`

Varianti in streaming: Server-Sent Events e canali WebSocket mockati, con copione dei messaggi,
regole di risposta dichiarative, comportamento a fine copione e preset della console.

```text
Usa $mockxy-realtime-mock per creare uno stream SSE su /api/eventi che emette tre eventi di
avanzamento e poi resta aperto.
```

### Come si combinano

`mockxy-workspace` possiede il file endpoint ed è il punto di partenza; le altre tre possiedono il
contenuto delle varianti. Un endpoint completo nasce quasi sempre da due skill: una per il file
endpoint, una per la variante. Ogni skill resta comunque utilizzabile da sola.

## Validare un workspace

Il validatore incluso in `mockxy-workspace` ricalca i controlli che il motore Mockxy esegue al
caricamento, così un errore di formato emerge subito invece di far sparire silenziosamente un
endpoint:

```sh
node skills/mockxy-workspace/scripts/validate-workspace.js /percorso/del/workspace
```

Si passa la radice del workspace, la cartella che contiene `mockxy.json` e `mocks/`;
`--mocks-dir <cartella>` indica invece direttamente una cartella dei mock. Una cartella che
potrebbe essere l'una o l'altra (contiene una sottocartella `mocks` e file di mock propri) viene
rifiutata, non interpretata. Altre opzioni: `--json` per un
report leggibile da programma, `--no-scripts` per non caricare i sorgenti di handler e middleware,
`--quiet` per il solo riepilogo. Esce con codice 1 quando trova errori.

Al validatore basta Node: controlla il formato, carica gli script handler e middleware e verifica
ciò che esportano. Il **contratto degli script** (dove e come uno script può fare `require` di
codice locale) lo controlla il motore Mockxy, che ha il parser adatto. Indicando al validatore
dove si trova un motore, usa la validazione completa di quel motore; altrimenti il report dichiara
che il contratto non è stato controllato.

```sh
# un Mockxy in esecuzione, usato solo se serve proprio questo workspace
node skills/mockxy-workspace/scripts/validate-workspace.js /percorso/del/workspace --server-url http://127.0.0.1:3000
# una cartella di Mockxy, senza server
node skills/mockxy-workspace/scripts/validate-workspace.js /percorso/del/workspace --engine-dir /percorso/di/mockxy
```

Entrambe richiedono un motore successivo a Mockxy 1.5.0. Il validatore non cerca mai un server
per conto suo.

## Struttura del repository

```text
skills/
  mockxy-<nome-skill>/
    SKILL.md
    agents/        # metadati opzionali per gli agenti
    scripts/       # strumenti eseguibili opzionali
    references/    # documentazione opzionale caricata quando serve
    assets/        # template e risorse statiche opzionali
```

Ogni skill è autosufficiente: non legge file appartenenti a un'altra skill, perché l'utente può
installarle singolarmente. Il nome della cartella e il campo `name` del suo `SKILL.md` devono
coincidere, usare il formato kebab-case minuscolo e cominciare con `mockxy-`.

I `SKILL.md` e le `references/` sono in inglese, per portabilità tra agenti. Il README ufficiale è
[README.md](README.md), in inglese; questa è la sua traduzione italiana, e le due versioni vanno
aggiornate insieme.

## Contribuire

Le linee guida per chi modifica il catalogo sono in [AGENTS.md](AGENTS.md). In sintesi: il formato
documentato deve rispecchiare ciò che il motore Mockxy carica davvero, il validatore va eseguito
su un workspace reale prima di ogni commit, e prima di creare un commit va verificato che il CLI
scopra tutte e sole le skill previste:

```sh
npx skills@latest add . --list
```

## Licenza

[MIT](LICENSE).
