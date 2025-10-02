window.onerror = function(msg, url, line, col, error) {
  document.getElementById('debug').textContent =
    "Erreur JS : " + msg + "\nLigne: " + line + "\n" + (error ? error.stack : "");
};
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
    $('#server-url').text(SERVER_URL);
    board = Chessboard('board', config);
    $('#new-game-form').on('submit', startNewGame);
    $('#reset-button').on('click', resetApp);
    
    // Assurez-vous que le plateau s'adapte à la taille de la fenêtre
    $(window).on('resize', board.resize);
    updateStatus("Prêt à commencer. Entrez votre ID et le niveau du bot.");
});

// --- Gestion des Événements du Plateau ---

function onDragStart (source, piece, position, orientation) {
    // Si la partie est terminée, ou si le bot joue, ou si ce n'est pas le tour des Blancs (l'humain)
    if (game.isGameOver() || isBotPlaying || game.turn() === 'b') {
        return false;
    }
    // L'humain ne peut bouger que les pièces blanches
    if (piece.search(/^b/) !== -1) {
        return false;
    }
}

async function onDrop (source, target) {
    moveAttempt = {
        from: source,
        to: target,
        promotion: 'q' // Simplifie la promotion en Reines par défaut
    };
    
    // Tente de faire le coup localement pour la validation immédiate
    const temp_move = game.move(moveAttempt);
    
    // Coup illégal selon chess.js
    if (temp_move === null) {
        return 'snapback';
    }
    
    // Le coup est légal localement, mais nous attendons la confirmation du serveur
    game.undo(); // Annule le coup local pour le faire uniquement après la confirmation du serveur

    // Envoyer le coup au serveur
    try {
        isBotPlaying = true; // Bloque le plateau
        $('#loading-overlay').show(); // Affiche l'indicateur de chargement
        updateStatus("Envoi du coup au serveur et attente de la réponse du bot...");

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
            throw new Error(errorData.detail || "Erreur inconnue du serveur.");
        }

        const data = await response.json();
        
        // 2. Exécution du coup du joueur (confirmé)
        game.move(temp_move);
        board.position(game.fen()); // Mise à jour du plateau pour le coup humain
        
        // 3. Animation et exécution du coup du bot (si présent)
        if (data.bot_move) {
            // Le coup du bot arrive déjà, on le joue immédiatement
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

    } catch (error) {
        console.error('Erreur lors de l’envoi du coup au serveur:', error);
        
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
    // Cette fonction est appelée après l'animation. C'est l'endroit idéal
    // pour s'assurer que le plateau visuel correspond au FEN logique.
    board.position(game.fen());
}

function onMoveEnd() {
    // S'assurer que le plateau est mis à jour après un move() programmé (comme le bot)
    board.position(game.fen());
}

// --- Fonctions d'Interaction avec le Serveur ---

async function startNewGame(event) {
    event.preventDefault();
    
    playerId = $('#player_id').val();
    botLevel = parseInt($('#bot_level').val());
    const selectedBot = $('#bot_level option:selected');
    const botIconPath = 'assets/bot_icons/' + selectedBot.data('icon');
    
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

    } catch (error) {
        console.error('Erreur lors du démarrage de la partie:', error);
        alert(`Impossible de démarrer la partie. Veuillez vérifier la console et l'URL du serveur: ${SERVER_URL}`);
        resetApp();
    }
}

function resetApp() {
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
    } else if (game.isDraw()) {
        status = 'PARTIE TERMINÉE : Nulle.';
        $('#reset-button').show();
    } else {
        status = `C'est au tour des ${moveColor} de jouer.`;
        if (game.isCheck()) {
            status = `<span style="color: #e67e22;">${status} (ATTENTION : Échec !)</span>`;
        }
    }

    $('#game-status').html(status);
}
