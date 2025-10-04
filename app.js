// --- Début du code de redirection du console ---

// Preserve original console functions
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

// Function to append message to the debug div
// Function to append message to the debug div
function appendToDebugDiv(type, message, ...optionalParams) {
  const debugDiv = document.getElementById('debug');
  if (debugDiv) {
    const formatParam = (param) => {
      if (param instanceof Error) { // <--- C'est la modification clé ici
        return `Error: ${param.message}\nStack: ${param.stack || 'No stack available'}`;
      }
      if (typeof param === 'object' && param !== null) {
        try {
          return JSON.stringify(param, null, 2); // Pretty print objects
        } catch (e) {
          return String(param); // Fallback for circular references etc.
        }
      }
      return String(param);
    };

    const formattedMessage = [message, ...optionalParams].map(formatParam).join(' ');

    const line = document.createElement('div');
    // Basic styling for different log types
    line.style.color = type === 'error' ? 'red' : (type === 'warn' ? 'orange' : 'white');
    line.style.borderBottom = '1px solid #333'; // Add a separator for readability
    line.style.padding = '5px 0';
    line.style.whiteSpace = 'pre-wrap'; // Preserve formatting
    line.style.wordBreak = 'break-all'; // Break long words

    line.textContent = `[${type.toUpperCase()}] ${new Date().toLocaleTimeString()}: ${formattedMessage}`;
    debugDiv.appendChild(line);
    debugDiv.scrollTop = debugDiv.scrollHeight; // Auto-scroll to bottom
  }
}


    const line = document.createElement('div');
    // Basic styling for different log types
    line.style.color = type === 'error' ? 'red' : (type === 'warn' ? 'orange' : 'white');
    line.style.borderBottom = '1px solid #333'; // Add a separator for readability
    line.style.padding = '5px 0';
    line.style.whiteSpace = 'pre-wrap'; // Preserve formatting
    line.style.wordBreak = 'break-all'; // Break long words

    line.textContent = `[${type.toUpperCase()}] ${new Date().toLocaleTimeString()}: ${formattedMessage}`;
    debugDiv.appendChild(line);
    debugDiv.scrollTop = debugDiv.scrollHeight; // Auto-scroll to bottom
  }
}

// Override console methods to redirect to the debug div
console.log = function(message, ...optionalParams) {
  appendToDebugDiv('log', message, ...optionalParams);
  // Uncomment the line below if you still want messages to appear in the browser console
  // originalConsoleLog(message, ...optionalParams);
};

console.warn = function(message, ...optionalParams) {
  appendToDebugDiv('warn', message, ...optionalParams);
  // Uncomment the line below if you still want messages to appear in the browser console
  // originalConsoleWarn(message, ...optionalParams);
};

console.error = function(message, ...optionalParams) {
  appendToDebugDiv('error', message, ...optionalParams);
  // Uncomment the line below if you still want messages to appear in the browser console
  // originalConsoleError(message, ...optionalParams);
};

// Existing window.onerror for uncaught JS errors, now also redirected
window.onerror = function(msg, url, line, col, error) {
  const errorText = `Erreur JS : ${msg}\nLigne: ${line}\nCol: ${col}\nURL: ${url}\n${error ? error.stack : ""}`;
  appendToDebugDiv('error', errorText);
  return true; // Prevent default browser error handling (e.g., console logging)
};

// --- Fin du code de redirection du console ---

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
    console.log("Initialisation de l'application...");
    $('#server-url').text(SERVER_URL);
    board = Chessboard('board', config);
    $('#new-game-form').on('submit', startNewGame);
    $('#reset-button').on('click', resetApp);
    
    // Assurez-vous que le plateau s'adapte à la taille de la fenêtre
    $(window).on('resize', board.resize);
    updateStatus("Prêt à commencer. Entrez votre ID et le niveau du bot.");
    console.log("Application prête.");
});

// --- Gestion des Événements du Plateau ---

function onDragStart (source, piece, position, orientation) {
    console.log(`Début du glisser-déposer: ${piece} de ${source}`);
    // Si la partie est terminée, ou si le bot joue, ou si ce n'est pas le tour des Blancs (l'humain)
    if (game.isGameOver() || isBotPlaying || game.turn() === 'b') {
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
    console.log(`Coup tenté: de ${source} à ${target}`);
    moveAttempt = {
        from: source,
        to: target,
        promotion: 'q' // Simplifie la promotion en Reines par défaut
    };
    
    // Tente de faire le coup localement pour la validation immédiate
    const temp_move = game.move(moveAttempt);
    
    // Coup illégal selon chess.js
    if (temp_move === null) {
        console.error("Coup illégal détecté localement par chess.js. Retour à la position.");
        return 'snapback';
    }
    
    // Le coup est légal localement, mais nous attendons la confirmation du serveur
    game.undo(); // Annule le coup local pour le faire uniquement après la confirmation du serveur
    console.log("Coup localement valide, annulation temporaire pour envoi au serveur.");

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
            console.error("Erreur réponse serveur lors de l'envoi du coup:", errorData);
            throw new Error(errorData.detail || "Erreur inconnue du serveur.");
        }

        const data = await response.json();
        console.log("Réponse du serveur reçue:", data);
        
        // 2. Exécution du coup du joueur (confirmé)
        game.move(temp_move);
        board.position(game.fen()); // Mise à jour du plateau pour le coup humain
        console.log(`Coup humain (${temp_move.uci}) exécuté et confirmé.`);
        
        // 3. Animation et exécution du coup du bot (si présent)
        if (data.bot_move) {
            console.log(`Coup du bot reçu: ${data.bot_move}`);
            const bot_move = game.move(data.bot_move);
            if (bot_move === null) {
                console.error("Le serveur a retourné un coup illégal pour le bot:", data.bot_move);
                // On laisse le jeu dans l'état après le coup humain pour la détection du problème
            }
            // board.move(data.bot_move) va appeler onSnapEnd
        }
        
        // Mise à jour finale du plateau et du statut
        board.position(game.fen());
        $('#loading-overlay').hide();
        updateStatus();
        isBotPlaying = false;
        console.log("Tour terminé, bot a joué (si applicable).");

    } catch (error) {
        console.error('Erreur lors de l’envoi du coup au serveur ou traitement:', error);
        
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
    console.log("Animation de déplacement de pièce terminée.");
    board.position(game.fen());
}

function onMoveEnd() {
    console.log("Événement onMoveEnd déclenché.");
    board.position(game.fen());
}

// --- Fonctions d'Interaction avec le Serveur ---

async function startNewGame(event) {
    event.preventDefault();
    
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
             console.error("Erreur réponse serveur lors de la création de partie:", errorData);
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
        console.error('Erreur lors du démarrage de la partie:', error);
        alert(`Impossible de démarrer la partie. Veuillez vérifier la console et l'URL du serveur: ${SERVER_URL}`);
        resetApp();
    }
}

function resetApp() {
    console.log("Réinitialisation de l'application.");
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
        console.log("Mise à jour du statut avec message spécifique:", message);
        $('#game-status').html(`<span style="color: #c0392b;">${message}</span>`);
        return;
    }
    
    let status = '';
    let moveColor = 'Blancs';

    if (game.turn() === 'b') {
        moveColor = 'Noirs';
    }

    if (game.isCheckmate()) {
        status = 'PARTIE TERMINÉE : ' + moveColor + ' est en échec et mat.';
        $('#reset-button').show();
        console.log("Partie terminée: Échec et mat.");
    } else if (game.isDraw()) {
        status = 'PARTIE TERMINÉE : Nulle.';
        $('#reset-button').show();
        console.log("Partie terminée: Nulle.");
    } else {
        status = `C'est au tour des ${moveColor} de jouer.`;
        if (game.isCheck()) {
            status = `<span style="color: #e67e22;">${status} (ATTENTION : Échec !)</span>`;
            console.log("Partie en cours: Échec !");
        } else {
            console.log("Partie en cours.");
        }
    }

    $('#game-status').html(status);
}
