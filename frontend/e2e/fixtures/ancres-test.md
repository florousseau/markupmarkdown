# Test des ancres internes

Document de vérification des liens intra-document (`#ancre`) dans markupmarkdown.
Chaque lien de la table des matières doit faire défiler jusqu'au titre visé ;
l'URL doit se terminer par l'ancre correspondante (partageable).

## Table des matières

1. [Résumé exécutif](#résumé-exécutif)
2. [Intro (premier)](#intro)
3. [Intro (second, doublon)](#intro-1)
4. [Ponctuation et emoji](#-qa--v20-cest--prêt--)
5. [Chiffres et majuscules](#3-étapes-clés-2026)
6. [Symboles](#coût--bénéfice-)
7. [Ancre HTML brute](#ancre-manuelle)
8. [Titre en majuscules dans le lien](#Résumé-Exécutif)
9. [Section de fin](#fin-du-document)

Liens de contrôle :

- [Lien externe](https://example.com/) — doit ouvrir le site normalement.
- [Ancre inexistante](#cette-section-nexiste-pas) — ne doit rien casser.
- [Dièse seul](#) — ne doit rien casser.

## Résumé exécutif

Cette phrase porte un commentaire de non-régression.

Paragraphe de remplissage 1. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 2. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 3. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 4. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 5. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 6. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## Intro

Premier titre « Intro ». Le lien n°2 doit arriver ici.

Paragraphe de remplissage 1. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 2. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 3. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 4. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 5. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 6. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## Intro

Second titre « Intro » (doublon, id `intro-1`). Le lien n°3 doit arriver ici, pas au premier.

Paragraphe de remplissage 1. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 2. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 3. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 4. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 5. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 6. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## 🚀 Q&A : v2.0, c'est « prêt » ?

Titre avec emoji, esperluette, deux-points, point, apostrophe et guillemets français.

Paragraphe de remplissage 1. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 2. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 3. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 4. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 5. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 6. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## 3 Étapes CLÉS 2026

Titre avec chiffres, majuscules et accents majuscules.

Paragraphe de remplissage 1. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 2. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 3. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 4. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 5. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 6. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## Coût / bénéfice (€)

Titre avec barre oblique, parenthèses et symbole monétaire.

Paragraphe de remplissage 1. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 2. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 3. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 4. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 5. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 6. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

<a id="ancre-manuelle"></a>
Paragraphe précédé d'une ancre HTML brute `<a id="ancre-manuelle"></a>`.

Paragraphe de remplissage 1. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 2. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 3. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 4. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 5. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

Paragraphe de remplissage 6. Ce texte sert uniquement à allonger le document pour que chaque section soit loin des autres et que le défilement soit réellement nécessaire. Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.

## Fin du document

[Retour en haut](#test-des-ancres-internes) · [Retour au résumé](#résumé-exécutif)
