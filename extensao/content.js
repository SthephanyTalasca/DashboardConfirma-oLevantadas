// =============================================
// SLACK HUBSPOT READER - Content Script
// =============================================

console.log('🚀 Slack HubSpot Reader ativo!');

// Armazena mensagens já processadas para não duplicar
const mensagensProcessadas = new Set();

// Função principal que extrai os negócios do HubSpot
function extrairNegocios() {
  const negocios = [];
  
  // Busca todas as mensagens do HubSpot APP
  // O Slack usa diferentes estruturas, então tentamos várias
  const mensagens = document.querySelectorAll('[data-qa="message_container"], .c-message_kit__message, .c-message');
  
  mensagens.forEach(msg => {
    const texto = msg.textContent || '';
    
    // Verifica se é uma mensagem do HubSpot sobre negócio criado
    if (texto.includes('Negócio criado!') || texto.includes('HubSpot')) {
      
      // Cria um ID único baseado no conteúdo para evitar duplicatas
      const msgId = texto.substring(0, 100).replace(/\s+/g, '');
      
      if (!mensagensProcessadas.has(msgId)) {
        mensagensProcessadas.add(msgId);
        
        // Extrai as informações
        const negocio = parsearMensagemHubSpot(msg, texto);
        if (negocio) {
          negocios.push(negocio);
        }
      }
    }
  });
  
  return negocios;
}

// Parser específico para mensagens do HubSpot
function parsearMensagemHubSpot(elemento, textoCompleto) {
  try {
    // Pega o timestamp
    const timeEl = elemento.querySelector('time, [data-qa="message_time"]');
    const timestamp = timeEl ? timeEl.getAttribute('datetime') || timeEl.textContent : new Date().toISOString();
    
    // Divide o texto em linhas para extrair os campos
    const linhas = textoCompleto
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.includes('Exibir contato') && !l.includes('Resumir contato'));
    
    // Padrão esperado:
    // HubSpot APP HHhMM
    // Negócio criado! ⭐
    // Nome do Cliente
    // Tipo/Equipe (Sucesso, CecconSucesso, etc)
    // Nome do Responsável
    
    let cliente = '';
    let equipe = '';
    let responsavel = '';
    let tipo = '⭐'; // default
    
    // Detecta o tipo pelo emoji
    if (textoCompleto.includes('✨')) tipo = '✨';
    if (textoCompleto.includes('🌟')) tipo = '🌟';
    
    // Encontra o índice de "Negócio criado"
    const idxNegocio = linhas.findIndex(l => l.includes('Negócio criado'));
    
    if (idxNegocio !== -1 && linhas.length > idxNegocio + 1) {
      // Próximas linhas após "Negócio criado"
      const camposRestantes = linhas.slice(idxNegocio + 1).filter(l => 
        !l.includes('HubSpot') && 
        !l.includes('APP') &&
        l.length > 1
      );
      
      if (camposRestantes.length >= 1) cliente = camposRestantes[0];
      if (camposRestantes.length >= 2) equipe = camposRestantes[1];
      if (camposRestantes.length >= 3) responsavel = camposRestantes[2];
    }
    
    // Se não conseguiu extrair, tenta método alternativo
    if (!cliente) {
      const matches = textoCompleto.match(/Negócio criado!.*?\n(.+?)\n(.+?)\n(.+?)(\n|$)/s);
      if (matches) {
        cliente = matches[1]?.trim() || '';
        equipe = matches[2]?.trim() || '';
        responsavel = matches[3]?.trim() || '';
      }
    }
    
    // Só retorna se tiver pelo menos o cliente
    if (cliente) {
      return {
        id: Date.now() + Math.random().toString(36).substr(2, 9),
        cliente: cliente,
        equipe: equipe,
        responsavel: responsavel,
        tipo: tipo,
        timestamp: timestamp,
        dataCaptura: new Date().toISOString()
      };
    }
    
    return null;
  } catch (e) {
    console.error('Erro ao parsear mensagem:', e);
    return null;
  }
}

// Salva os negócios no localStorage para a página ler
function salvarNegocios(negocios) {
  if (negocios.length === 0) return;
  
  // Pega negócios existentes
  const existentes = JSON.parse(localStorage.getItem('hubspot_negocios') || '[]');
  
  // Adiciona os novos (evitando duplicatas por cliente + timestamp similar)
  negocios.forEach(novo => {
    const jáExiste = existentes.some(e => 
      e.cliente === novo.cliente && 
      Math.abs(new Date(e.dataCaptura) - new Date(novo.dataCaptura)) < 60000 // 1 minuto
    );
    
    if (!jáExiste) {
      existentes.unshift(novo); // Adiciona no início
    }
  });
  
  // Mantém só os últimos 500
  const limitado = existentes.slice(0, 500);
  
  localStorage.setItem('hubspot_negocios', JSON.stringify(limitado));
  localStorage.setItem('hubspot_ultima_atualizacao', new Date().toISOString());
  
  console.log(`✅ ${negocios.length} novos negócios salvos! Total: ${limitado.length}`);
  
  // Dispara evento customizado para a página saber que atualizou
  window.dispatchEvent(new CustomEvent('hubspot_atualizado', { 
    detail: { novos: negocios.length, total: limitado.length } 
  }));
}

// Função para exportar dados (usada pelo popup)
function exportarDados() {
  const dados = localStorage.getItem('hubspot_negocios') || '[]';
  return JSON.parse(dados);
}

// Expõe função globalmente para o popup acessar
window.exportarNegociosHubSpot = exportarDados;

// Observer para detectar novas mensagens em tempo real
function iniciarObserver() {
  const observer = new MutationObserver((mutations) => {
    let temNovaMensagem = false;
    
    mutations.forEach(mutation => {
      if (mutation.addedNodes.length > 0) {
        mutation.addedNodes.forEach(node => {
          if (node.textContent && node.textContent.includes('Negócio criado')) {
            temNovaMensagem = true;
          }
        });
      }
    });
    
    if (temNovaMensagem) {
      setTimeout(() => {
        const negocios = extrairNegocios();
        if (negocios.length > 0) {
          salvarNegocios(negocios);
        }
      }, 500); // Pequeno delay para o DOM estabilizar
    }
  });
  
  // Observa o container principal de mensagens
  const container = document.querySelector('[data-qa="message_list"], .c-message_list, .p-message_pane');
  
  if (container) {
    observer.observe(container, {
      childList: true,
      subtree: true
    });
    console.log('👀 Observer ativo! Monitorando novas mensagens...');
  } else {
    // Tenta novamente em 2 segundos (página ainda carregando)
    setTimeout(iniciarObserver, 2000);
  }
}

// Executa extração inicial
setTimeout(() => {
  const negocios = extrairNegocios();
  if (negocios.length > 0) {
    salvarNegocios(negocios);
  }
  iniciarObserver();
}, 2000);

// Também executa a cada 30 segundos como fallback
setInterval(() => {
  const negocios = extrairNegocios();
  if (negocios.length > 0) {
    salvarNegocios(negocios);
  }
}, 30000);

console.log('📊 Extensão pronta! Os dados ficam em localStorage["hubspot_negocios"]');
