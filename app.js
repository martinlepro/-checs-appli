// --- Début du code de redirection du console ---

// Fonction pour ajouter un message au div de débogage
function appendToDebugDiv(type, message, ...optionalParams) {
  const debugDiv = document.getElementById('debug');
  if (debugDiv) {
    const formatParam = (param) => {
      // Gérer spécifiquement les objets Error pour afficher leur message et leur stack
      if (param instanceof Error) {
        return `Error: ${param.message}\nStack: ${param.stack || 'No stack available'}`;
      }
      // Gérer les objets normaux en les convertissant en JSON lisible
      if (typeof param === 'object' && param !== null) {
        try {
          return JSON.stringify(param, null, 2); // Affiche les objets de manière lisible
        } catch (e) {
          return String(param); // Solution de secours pour les objets avec références circulaires
        }
      }
      return String(param);
    };

    const formattedMessage = [message, ...optionalParams].map(formatParam).join(' ');

    const line = document.createElement('div');
    // Style de base pour différents types de logs
    line.style.color = type === 'error' ? 'red' : (type === 'warn' ? 'orange' : 'white');
    line.style.borderBottom = '1px solid #333'; // Ajoute un séparateur pour la lisibilité
    line.style.padding = '5px 0';
    line.style.whiteSpace = 'pre-wrap'; // Préserve la mise en forme (sauts de ligne)
    line.style.wordBreak = 'break-all'; // Coupe les longs mots si nécessaire

    line.textContent = `[${type.toUpperCase()}] ${new Date().toLocaleTimeString()}: ${formattedMessage}`;
    debugDiv.appendChild(line);
    debugDiv.scrollTop = debugDiv.scrollHeight; // Fait défiler automatiquement vers le bas
  }
}

// Redirection des méthodes console natives vers notre div de débogage
// Vous pouvez décommenter les lignes 'originalConsoleLog' si vous voulez aussi voir les logs dans la vraie console du navigateur
console.log = function(message, ...optionalParams) {
  appendToDebugDiv('log', message, ...optionalParams);
  // originalConsoleLog(message, ...optionalParams);
};

console.warn = function(message, ...optionalParams) {
  appendToDebugDiv('warn', message, ...optionalParams);
  // originalConsoleWarn(message, ...optionalParams);
};

console.error = function(message, ...optionalParams) {
  appendToDebugDiv('error', message, ...optionalParams);
  // originalConsoleError(message, ...optionalParams);
};

// Gère les erreurs JavaScript non capturées dans le navigateur
window.onerror = function(msg, url, line, col, error) {
  const errorText = `Erreur JS non capturée : ${msg}\nLigne: ${line}\nCol: ${col}\nURL: ${url}\n${error ? error.stack : ""}`;
  appendToDebugDiv('error', errorText);
  return true; // Empêche le comportement par défaut du navigateur (par exemple, le logging dans sa console)
};

// --- Fin du code de redirection du console ---

// Message de confirmation que les overrides sont chargés
console.log("Console overrides chargés ! Les logs devraient apparaître dans le div #debug.");

// URL de votre service FastAPI déployé sur Render.
// ASSUREZ-VOUS DE REMPLACER CECI PAR VOTRE VRAIE URL DE DÉPLOIEMENT
const SERVER_URL = 'https://echecs-serveur.onrender.com';

// --- État de l'application ---
let board = null;
let game = new Chess();
let gameId = null;
let playerId = null;
let botLevel = 1500;
let isBotPlaying = false; // Flag pour bloquer les coups pendant que le bot réfléchit
let moveAttempt = null; // Stocke le coup tenté pour le snapback en cas d'erreur API

const config = {
    draggable: true,
    position: 'start',
    onDragStart: onDragStart,
    onDrop: onDrop,
    onSnapEnd: onSnapEnd,
    onMoveEnd: onMoveEnd,
    orientation: 'white' // L'humain est toujours les Blancs
};

// --- Initialisation ---

$(document).ready(function() {
    console.log("Initialisation de l'application cliente...");
    $('#server-url').text(SERVER_URL);
    board = Chessboard('board', config);
    
    // Assurez-vous que l'écouteur d'événement est bien attaché
    $('#new-game-form').on('submit', startNewGame);
    $('#reset-button').on('click', resetApp);
    
    // Assurez-vous que le plateau s'adapte à la taille de la fenêtre
    $(window).on('resize', board.resize);
    updateStatus("Prêt à commencer. Entrez votre ID et le niveau du bot.");
    console.log("Application cliente prête et en attente d'interaction.");
});

// --- Gestion des Événements du Plateau ---

function onDragStart (source, piece, position, orientation) {
    console.log(`Début du glisser-déposer: ${piece} de ${source}`);
    // Si la partie est terminée (correction), ou si le bot joue, ou si ce n'est pas le tour des Blancs (l'humain)
    if (game.game_over() || isBotPlaying || game.turn() === 'b') { // <-- CORRECTION ICI
        console.warn("Mouvement interdit: partie terminée, bot joue, ou ce n'est pas le tour des Blancs.");
        return false;
    }
    // L'humain ne peut bouger que les pièces blanches
    if (piece.search(/^b/) !== -1) {
        console.warn("Mouvement interdit: l'humain ne peut bouger que les pièces blanches.");
        return false;
    }
}

async function onDrop (source, target) {
    console.log(`Coup tenté par le joueur: de ${source} à ${target}`);
    moveAttempt = {
        from: source,
        to: target,
        promotion: 'q' // Simplifie la promotion en Reines par défaut
    };
    
    // Tente de faire le coup localement pour la validation immédiate
    const temp_move = game.move(moveAttempt);
    
    // Coup illégal selon chess.js
    if (temp_move === null) {
        console.error("Coup illégal détecté localement par chess.js. La pièce retourne à sa position initiale.");
        return 'snapback';
    }
    
    // Le coup est légal localement, mais nous attendons la confirmation du serveur
    game.undo(); // Annule le coup local pour le faire uniquement après la confirmation du serveur
    console.log(`Coup (${temp_move.uci}) localement valide, annulé temporairement en attendant la confirmation serveur.`);

    // Envoyer le coup au serveur
    try {
        isBotPlaying = true; // Bloque le plateau
        $('#loading-overlay').show(); // Affiche l'indicateur de chargement
        updateStatus("Envoi du coup au serveur et attente de la réponse du bot...");
        console.log("Envoi du coup joueur au serveur...", { game_id: gameId, player_id: playerId, uci_move: temp_move.uci });

        // 1. Envoi du coup joueur au serveur
        const response = await fetch(`${SERVER_URL}/game/move`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                game_id: gameId,
                player_id: playerId,
                uci_move: temp_move.uci
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error("Erreur serveur lors de l'envoi du coup (réponse non-OK):", errorData);
            throw new Error(errorData.detail || "Erreur inconnue du serveur.");
        }

        const data = await response.json();
        console.log("Réponse du serveur reçue (après coup joueur et bot):", data);
        
        // 2. Exécution du coup du joueur (confirmé par le serveur)
        game.move(temp_move);
        board.position(game.fen()); // Mise à jour du plateau pour le coup humain
        console.log(`Coup humain (${temp_move.uci}) exécuté et confirmé par le serveur.`);
        
        // 3. Animation et exécution du coup du bot (si présent)
        if (data.bot_move) {
            console.log(`Coup du bot reçu du serveur: ${data.bot_move}`);
            const bot_move = game.move(data.bot_move);
            if (bot_move === null) {
                console.error("Le serveur a retourné un coup illégal pour le bot:", data.bot_move, "FEN actuel:", game.fen());
                // On laisse le jeu dans l'état après le coup humain pour la détection du problème
            }
            // board.move(data.bot_move) va appeler onSnapEnd
        }
        
        // Mise à jour finale du plateau et du statut
        board.position(game.fen());
        $('#loading-overlay').hide();
        updateStatus();
        isBotPlaying = false;
        console.log("Tour terminé. Bot a joué (si applicable) et plateau mis à jour.");

    } catch (error) {
        console.error('Erreur lors de l’envoi du coup au serveur ou traitement de la réponse:', error);
        
        // Le coup est refusé par le serveur : restaure l'ancienne position
        board.position(game.fen(), false); // 'false' force un snapback
        $('#loading-overlay').hide();
        updateStatus(`Erreur du serveur: ${error.message}.`);
        isBotPlaying = false;
        
        // Retourne 'snapback' pour faire revenir la pièce à sa place initiale visuellement
        return 'snapback';
    }
}

function onSnapEnd () {
    console.log("Animation de déplacement de pièce terminée. Mise à jour finale du plateau.");
    board.position(game.fen());
}

function onMoveEnd() {
    console.log("Événement onMoveEnd déclenché. S'assure que le plateau visuel correspond au FEN.");
    board.position(game.fen());
}

// --- Fonctions d'Interaction avec le Serveur ---

async function startNewGame(event) {
    // Empêche le comportement par défaut du formulaire, ce qui évite le rechargement de la page
    event.preventDefault(); 
    console.log("Soumission du formulaire de nouvelle partie interceptée.");
    
    playerId = $('#player_id').val();
    botLevel = parseInt($('#bot_level').val());
    const selectedBot = $('#bot_level option:selected');
    const botIconPath = 'assets/bot_icons/' + selectedBot.data('icon');
    
    console.log(`Tentative de démarrage d'une nouvelle partie. Joueur: ${playerId}, Bot Elo: ${botLevel}`);

    try {
        // Envoi de la requête pour créer une nouvelle partie
        const response = await fetch(`${SERVER_URL}/game/new`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                player_white_id: playerId,
                opponent_type: 'bot',
                opponent_level: botLevel
            })
        });

        if (!response.ok) {
             const errorData = await response.json();
             console.error("Erreur serveur lors de la création de partie (réponse non-OK):", errorData);
             throw new Error(errorData.detail || "Échec de la création de partie.");
        }

        const data = await response.json();
        gameId = data.game_id;
        game.reset(); 
        board.position(data.initial_fen); 
        
        // Mise à jour de l'affichage de l'interface
        $('#setup-section').hide();
        $('#game-section').show();
        
        // Mise à jour des informations joueur/bot
        $('#bot-icon').attr('src', botIconPath);
        $('#bot-name').text(`Bot (${botLevel} Elo)`);
        $('#human-name').text(playerId);

        updateStatus("Partie commencée ! C'est le tour des Blancs.");
        console.log(`Partie ${gameId} créée avec succès. FEN initial: ${data.initial_fen}`);

    } catch (error) {
        console.error('Erreur irrécupérable lors du démarrage de la partie:', error);
        alert(`Impossible de démarrer la partie. Vérifiez la console (F12) et l'URL du serveur: ${SERVER_URL}`);
        resetApp();
    }
}

function resetApp() {
    console.log("Réinitialisation de l'application et du jeu.");
    gameId = null;
    game.reset();
    board.position('start');
    $('#setup-section').show();
    $('#game-section').hide();
    $('#reset-button').hide();
    isBotPlaying = false;
    updateStatus("Prêt à commencer une nouvelle partie.");
}


// --- Fonction de Mise à Jour du Statut ---

function updateStatus (message = null) {
    if (message) {
        console.log("Mise à jour du statut avec message d'erreur/information spécifique:", message);
        $('#game-status').html(`<span style="color: #c0392b;">${message}</span>`);
        return;
    }
    
    let status = '';
    let moveColor = 'Blancs';

    if (game.turn() === 'b') {
        moveColor = 'Noirs';
    }

    // CORRECTIONS ICI
    if (game.in_checkmate()) { // <-- CORRECTION ICI
        status = 'PARTIE TERMINÉE : ' + moveColor + ' est en échec et mat.';
        $('#reset-button').show();
        console.log("Partie terminée: Échec et mat !");
    } else if (game.in_draw()) { // <-- CORRECTION ICI
        status = 'PARTIE TERMINÉE : Nulle.';
        $('#reset-button').show();
        console.log("Partie terminée: Nulle !");
    } else {
        status = `C'est au tour des ${moveColor} de jouer.`;
        if (game.in_check()) { // <-- CORRECTION ICI
            status = `<span style="color: #e67e22;">${status} (ATTENTION : Échec !)</span>`;
            console.warn("Partie en cours: Le joueur actuel est en échec !");
        } else {
            console.log("Partie en cours: C'est le tour de", moveColor);
        }
    }

    $('#game-status').html(status);
}
