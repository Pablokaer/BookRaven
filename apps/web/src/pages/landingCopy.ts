/**
 * The front page's words: "/" in English, "/pt" in Portuguese (LandingPage.tsx; both are
 * prerendered by scripts/prerender.mjs). Keep the two in step.
 */
export type LandingLang = "en" | "pt";

type Pair = readonly [string, string];

export type LandingCopy = {
  htmlLang: string;
  title: string;
  description: string;
  home: string;
  homeLabel: string;
  otherHome: string;
  otherLang: string;
  otherLabel: string;
  skip: string;
  nav: readonly Pair[];
  signIn: string;
  createAccount: string;
  createAnAccount: string;
  invitationOnly: string;
  heroPlate: string;
  heroEyebrow: Pair;
  heroTitle: readonly [string, string, string];
  heroText: string;
  readerCaption: string;
  readerSynced: string;
  libraryEyebrow: string;
  libraryTitle: Pair;
  libraryText: string;
  articles: readonly { title: string; text: string }[];
  scholarAlt: string;
  plateII: string;
  journeyEyebrow: string;
  journeyTitle: Pair;
  journeyText: string;
  journey: readonly { title: string; text: string; alt: string }[];
  shelvesEyebrow: string;
  shelvesTitle: Pair;
  shelvesText: string;
  shelvesFacts: readonly Pair[];
  shelvesNav: string;
  shelvesPick: string;
  shelvesNote: string;
  /** Section names and blurbs, when not the English ones of lib/themes.ts. */
  themes?: Record<string, { label: string; blurb: string }>;
  classicsLink: string;
  classicsCta: string;
  classicsShort: string;
  finaleTitle: Pair;
  finaleOpen: string;
  finaleClosed: string;
  tagline: string;
  colophonTitle: string;
  colophon: readonly { title: string; text: string }[];
  sourceCode: string;
  newTab: string;
  credits: Pair;
};

export const LANDING_COPY: Record<LandingLang, LandingCopy> = {
  en: {
    htmlLang: "en",
    title: "BookRaven · Read ebooks, PDFs and comics online, synced on every device",
    description:
      "BookRaven is a free reader for EPUB, MOBI, PDF and comics (CBZ, CBR). Read in the browser, on Android or on KOReader, with your place, highlights and bookmarks synced, and hundreds of free classics.",
    home: "/",
    homeLabel: "BookRaven home",
    otherHome: "/pt",
    otherLang: "pt-BR",
    otherLabel: "Português",
    skip: "Skip to content",
    nav: [
      ["#library", "The library"],
      ["#journey", "How it works"],
      ["#shelves", "Public Library"],
    ],
    signIn: "Sign in",
    createAccount: "Create account",
    createAnAccount: "Create an account",
    invitationOnly: "New accounts are by invitation on this server.",
    heroPlate: "Plate after Gustave Doré, 1884",
    heroEyebrow: ["A library of your own", "ebooks, PDFs & comics"],
    heroTitle: ["Every book", "holds", "a world."],
    heroText:
      "Your stories, your collection, kept on a server of your own. Read in the browser, the Android app or on an e-reader, and every device opens on the very sentence where you stopped.",
    readerCaption: "The reader open on a page of The Raven, with a highlight, a bookmark and the place synced from a phone.",
    readerSynced: "Continued from your phone · just now",
    libraryEyebrow: "Chapter I · The library",
    libraryTitle: ["A library of your own,", "kept on your own shelves."],
    libraryText:
      "BookRaven gathers the books you own into one library that lives on a server of your choosing, not in a store’s cloud. It reads DRM-free files, so the books you bring are the books you keep, with every highlight, note and reading hour that comes with them.",
    articles: [
      {
        title: "Every format, one shelf",
        text: "EPUB, MOBI, AZW3 and FB2, PDFs, and comics as CBZ, CBR, CB7 or CBT. Drop them in, or bring a whole Calibre library and your Goodreads shelves: title, author and cover are read from each file, and duplicates are skipped.",
      },
      {
        title: "Your place, on every device",
        text: "The web reader, the Android app and KOReader on e-ink keep one bookmark of where you are, down to the sentence. Positions are saved offline too, and the newest one always wins.",
      },
      {
        title: "Notes in the margin",
        text: "Highlights in four colors, notes and bookmarks, a pen for writing on PDFs, and a dictionary and translation for any word you select.",
      },
      {
        title: "Books for company",
        text: "Share a book or a whole collection by link, publish it to the Public Library, or read together in a book club and talk about passages.",
      },
    ],
    scholarAlt: "An engraving of a scholar in an armchair beside his bookshelves, a beam of lamplight crossing the dark room.",
    plateII: "Plate II",
    journeyEyebrow: "Chapter II · The journey",
    journeyTitle: ["From the first page found", "to the last one read."],
    journeyText:
      "Every book takes the same road through BookRaven, and you can join it anywhere: bring your own files, or start from the shelves already there.",
    journey: [
      {
        title: "Discover",
        text: "Browse the Public Library: public-domain classics from Project Gutenberg, Standard Ebooks and Wikisource, with suggestions drawn from what you read.",
        alt: "A raven flying in past a heavy curtain.",
      },
      {
        title: "Collect",
        text: "Upload EPUBs, PDFs and comics, or import a Calibre library. Sort them into collections, tags and favorites.",
        alt: "Leather-bound books stacked on a draped table.",
      },
      {
        title: "Read",
        text: "Open a book in the browser, the Android app or KOReader. It streams in pieces, keeps working offline, and remembers your place.",
        alt: "A reader leaning on his desk beside a lamp.",
      },
      {
        title: "Share",
        text: "Send a book or a collection by link, publish it for everyone on the server, or read together in a book club.",
        alt: "A raven at a shuttered window, its shadow cast across an ivy-covered wall.",
      },
    ],
    shelvesEyebrow: "Chapter III · The Public Library",
    shelvesTitle: ["Shelves of classics,", "open to every reader here."],
    shelvesText:
      "Every account on a server shares its Public Library: public-domain books in English and Portuguese, and anything readers choose to publish. Request what is missing and vote for the requests you want most.",
    shelvesFacts: [
      ["Sources", "Project Gutenberg · Standard Ebooks · Wikisource"],
      ["Shelved by", "Eleven sections, from philosophy to children’s books"],
      ["Suggested", "Recommended for you, from the books you read"],
    ],
    shelvesNav: "Public Library sections",
    shelvesPick: "Choose a section to browse its shelf.",
    shelvesNote: "What is on the shelves depends on this server: its administrator chooses what to import.",
    classicsLink: "/classics",
    classicsCta: "Browse the free classics",
    classicsShort: "Free classics",
    finaleTitle: ["Your next chapter", "begins here."],
    finaleOpen: "Make an account on this server, add your first book, and open it on whatever is closest.",
    finaleClosed: "Sign in, and the book you were reading opens where you left it.",
    tagline: "A reader for ebooks, PDFs and comics, synced on every device.",
    colophonTitle: "Colophon",
    colophon: [
      { title: "Your files, your server", text: "Books, notes and reading history are kept by this server, on its disk or in its own storage bucket." },
      { title: "Works offline", text: "The library opens without a connection, and books you have opened keep working." },
      { title: "An Android app, no store needed", text: "Installed straight from the server, and it keeps itself up to date." },
      { title: "Fits in with your other apps", text: "An OPDS catalog, KOReader progress sync, and imports from Goodreads and Calibre." },
    ],
    sourceCode: "Source code",
    newTab: "(opens GitHub in a new tab)",
    credits: ["Engravings by Gustave Doré for Edgar Allan Poe’s", "(1884), in the public domain. Set in Cormorant Garamond and Inter."],
  },

  pt: {
    htmlLang: "pt-BR",
    title: "BookRaven · Leia e-books, PDFs e quadrinhos online, sincronizados em todos os aparelhos",
    description:
      "O BookRaven é um leitor gratuito de EPUB, MOBI, PDF e quadrinhos (CBZ, CBR). Leia no navegador, no Android ou no KOReader, com a página, os destaques e os marcadores sincronizados, e centenas de clássicos grátis.",
    home: "/pt",
    homeLabel: "Início do BookRaven",
    otherHome: "/",
    otherLang: "en",
    otherLabel: "English",
    skip: "Pular para o conteúdo",
    nav: [
      ["#library", "A biblioteca"],
      ["#journey", "Como funciona"],
      ["#shelves", "Biblioteca Pública"],
    ],
    signIn: "Entrar",
    createAccount: "Criar conta",
    createAnAccount: "Criar uma conta",
    invitationOnly: "Neste servidor, novas contas são só por convite.",
    heroPlate: "Gravura de Gustave Doré, 1884",
    heroEyebrow: ["Uma biblioteca só sua", "e-books, PDFs e quadrinhos"],
    heroTitle: ["Cada livro", "guarda", "um mundo."],
    heroText:
      "Suas histórias e sua coleção, num lugar só seu. Leia no navegador, no app Android ou num leitor de e-book, e cada aparelho abre exatamente na frase em que você parou.",
    readerCaption: "O leitor aberto numa página de O Corvo, com um destaque, um marcador e a posição sincronizada a partir do celular.",
    readerSynced: "Continuado do seu celular · agora",
    libraryEyebrow: "Capítulo I · A biblioteca",
    libraryTitle: ["Uma biblioteca só sua,", "nas suas próprias estantes."],
    libraryText:
      "O BookRaven reúne os livros que você tem numa biblioteca só, que fica num servidor escolhido por você, e não na nuvem de uma loja. Ele lê arquivos sem DRM: os livros que você traz são os livros que você guarda, com cada destaque, nota e hora de leitura.",
    articles: [
      {
        title: "Todos os formatos, uma estante",
        text: "EPUB, MOBI, AZW3 e FB2, PDFs e quadrinhos em CBZ, CBR, CB7 ou CBT. Arraste os arquivos, ou traga uma biblioteca inteira do Calibre e suas estantes do Goodreads: título, autor e capa são lidos de cada arquivo, e duplicados são ignorados.",
      },
      {
        title: "Sua página em todos os aparelhos",
        text: "O leitor na web, o app Android e o KOReader no e-ink guardam um só marcador de onde você está, até a frase. As posições são salvas também offline, e a mais recente sempre vale.",
      },
      {
        title: "Notas na margem",
        text: "Destaques em quatro cores, notas e marcadores, uma caneta para escrever em PDFs, e dicionário e tradução para qualquer palavra selecionada.",
      },
      {
        title: "Livros em boa companhia",
        text: "Compartilhe um livro ou uma coleção inteira por link, publique na Biblioteca Pública ou leia junto num clube do livro e converse sobre os trechos.",
      },
    ],
    scholarAlt: "Gravura de um estudioso numa poltrona ao lado das estantes, com um feixe de luz de lamparina cruzando o quarto escuro.",
    plateII: "Gravura II",
    journeyEyebrow: "Capítulo II · O caminho",
    journeyTitle: ["Da primeira página encontrada", "à última lida."],
    journeyText:
      "Todo livro faz o mesmo caminho pelo BookRaven, e você pode entrar em qualquer ponto: traga seus próprios arquivos ou comece pelas estantes que já estão lá.",
    journey: [
      {
        title: "Descubra",
        text: "Explore a Biblioteca Pública: clássicos em domínio público do Project Gutenberg, Standard Ebooks e Wikisource, com sugestões a partir do que você lê.",
        alt: "Um corvo entrando pela janela, passando por uma cortina pesada.",
      },
      {
        title: "Reúna",
        text: "Envie EPUBs, PDFs e quadrinhos, ou importe uma biblioteca do Calibre. Organize em coleções, etiquetas e favoritos.",
        alt: "Livros encadernados em couro empilhados sobre uma mesa coberta.",
      },
      {
        title: "Leia",
        text: "Abra um livro no navegador, no app Android ou no KOReader. Ele carrega aos poucos, funciona offline e lembra onde você parou.",
        alt: "Um leitor debruçado na escrivaninha ao lado de uma lamparina.",
      },
      {
        title: "Compartilhe",
        text: "Envie um livro ou uma coleção por link, publique para todos do servidor ou leia junto num clube do livro.",
        alt: "Um corvo numa janela fechada, a sombra projetada num muro coberto de hera.",
      },
    ],
    shelvesEyebrow: "Capítulo III · A Biblioteca Pública",
    shelvesTitle: ["Estantes de clássicos,", "abertas a todos os leitores."],
    shelvesText:
      "Todas as contas de um servidor compartilham a Biblioteca Pública: livros em domínio público em português e inglês, e o que os leitores decidirem publicar. Peça o que estiver faltando e vote nos pedidos que você mais quer.",
    shelvesFacts: [
      ["Fontes", "Project Gutenberg · Standard Ebooks · Wikisource"],
      ["Estantes", "Onze seções, da filosofia aos livros infantis"],
      ["Sugestões", "Recomendados para você, a partir do que você lê"],
    ],
    shelvesNav: "Seções da Biblioteca Pública",
    shelvesPick: "Escolha uma seção para ver a estante.",
    shelvesNote: "O que há nas estantes depende deste servidor: quem o administra escolhe o que importar.",
    themes: {
      philosophy: { label: "Filosofia", blurb: "Dos gregos ao Iluminismo e além" },
      politics: { label: "Política", blurb: "Governo, poder, direitos e revoluções" },
      economics: { label: "Economia", blurb: "Riqueza, comércio, trabalho e dinheiro" },
      technology: { label: "Tecnologia", blurb: "Engenharia, invenções e máquinas" },
      computing: { label: "Computação", blurb: "Os primeiros tempos dos computadores" },
      science: { label: "Ciência", blurb: "Física, biologia, astronomia, matemática" },
      history: { label: "História", blurb: "Acontecimentos, biografias e civilizações" },
      literature: { label: "Literatura", blurb: "Romances, contos e peças" },
      poetry: { label: "Poesia", blurb: "Versos, epopeias e sonetos" },
      religion: { label: "Religião", blurb: "Fé, escrituras e teologia" },
      children: { label: "Infantil", blurb: "Contos de fadas e jovens leitores" },
    },
    classicsLink: "/classics/pt",
    classicsCta: "Ver os clássicos grátis",
    classicsShort: "Clássicos grátis",
    finaleTitle: ["Seu próximo capítulo", "começa aqui."],
    finaleOpen: "Crie sua conta, adicione seu primeiro livro e abra no aparelho que estiver mais perto.",
    finaleClosed: "Entre, e o livro que você estava lendo abre onde você parou.",
    tagline: "Um leitor de e-books, PDFs e quadrinhos, sincronizado em todos os aparelhos.",
    colophonTitle: "Colofão",
    colophon: [
      { title: "Seus arquivos, seu servidor", text: "Livros, notas e histórico de leitura ficam guardados neste servidor, no disco dele ou no seu próprio armazenamento." },
      { title: "Funciona offline", text: "A biblioteca abre sem conexão, e os livros que você já abriu continuam funcionando." },
      { title: "Um app Android, sem loja", text: "Instalado direto do servidor, e ele se atualiza sozinho." },
      { title: "Combina com seus outros apps", text: "Catálogo OPDS, sincronização com o KOReader e importação do Goodreads e do Calibre." },
    ],
    sourceCode: "Código-fonte",
    newTab: "(abre o GitHub numa nova aba)",
    credits: ["Gravuras de Gustave Doré para", "de Edgar Allan Poe (1884), em domínio público. Tipografia Cormorant Garamond e Inter."],
  },
};
