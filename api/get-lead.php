<?php
/**
 * Endpoint para obtener un lead específico
 * GET /api/get-lead.php?id=123
 */

require_once __DIR__ . '/../config.php';

header('Content-Type: application/json; charset=utf-8');

// Solo aceptar GET
if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    jsonResponse([
        'success' => false,
        'message' => 'Método no permitido. Use GET.'
    ], 405);
}

try {
    $leadId = isset($_GET['id']) ? intval($_GET['id']) : 0;
    
    if ($leadId <= 0) {
        jsonResponse([
            'success' => false,
            'message' => 'ID de lead no válido'
        ], 400);
    }
    
    $db = Database::getInstance();
    
    // Obtener lead
    $lead = $db->fetchOne(
        "SELECT * FROM clientes WHERE Id = ? LIMIT 1",
        [$leadId]
    );
    
    if (!$lead) {
        jsonResponse([
            'success' => false,
            'message' => 'Lead no encontrado'
        ], 404);
    }
    
    jsonResponse([
        'success' => true,
        'lead' => $lead
    ]);
    
} catch (PDOException $e) {
    error_log("Error obteniendo lead: " . $e->getMessage());
    jsonResponse([
        'success' => false,
        'message' => 'Error al obtener el lead. Por favor, intente más tarde.'
    ], 500);
    
} catch (Exception $e) {
    error_log("Error inesperado: " . $e->getMessage());
    jsonResponse([
        'success' => false,
        'message' => 'Error inesperado. Por favor, contacte al administrador.'
    ], 500);
}

