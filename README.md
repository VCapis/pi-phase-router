# pi-phase-router

Extensão para o [Pi Coding Agent](https://github.com/earendil-works/pi) que usa um modelo diferente em cada etapa da sessão:

| Etapa | Chave na configuração | Modelo |
|---|---|---|
| Primeira resposta de uma sessão nova | `first` | A |
| Ferramentas, continuações e o resto da sessão | `work` | B |
| Resumo da compactação | `compaction` | C |
| Primeira resposta depois da compactação | `afterCompaction` | D |

Não precisa mexer no código do Pi. A extensão registra um **modelo virtual** (`phase/router`), um recurso nativo do Pi: você seleciona esse modelo uma vez e, antes de cada requisição, a extensão escolhe o modelo físico. O rodapé mostra o modelo usado em cada resposta (`router → modelo`), e o `/session` separa o custo por modelo.

Testado com o Pi 1.5.2 (`@earendil-works/pi-coding-agent`). O pacote antigo, `@mariozechner/pi-coding-agent`, parou na 0.73.1 e não serve.

## Instalação

```bash
pi install git:github.com/VCapis/pi-phase-router
```

Para só experimentar, sem instalar: clone o repositório e rode `pi -e ./pi-phase-router/src/index.ts`.

Depois, selecione `phase/router` no `/model` ou rode `pi --model phase/router`.

## Configuração

Crie `phase-router.json` em um destes lugares (vale o primeiro que existir):

1. o caminho da variável `PI_PHASE_ROUTER_CONFIG`;
2. `.pi/phase-router.json` dentro do projeto;
3. `~/.pi/agent/phase-router.json`.

```json
{
  "models": {
    "first":           ["anthropic/claude-opus-4-5", "openai/gpt-5"],
    "work":            "anthropic/claude-sonnet-4-5",
    "compaction":      ["google/gemini-2.5-flash", "anthropic/claude-haiku-4-5"],
    "afterCompaction": "anthropic/claude-opus-4-5"
  },
  "thinkingLevel": { "first": "high", "compaction": "off" }
}
```

- Cada etapa aceita um `"provedor/modelo"` ou uma lista. A lista é o **fallback**: vale o primeiro modelo que existe e tem credencial. Se uma requisição falhar e o Pi tentar de novo, a nova tentativa vai para o próximo modelo da lista.
- Só `work` é obrigatório. Etapa ausente usa o modelo de `work`.
- `thinkingLevel` é opcional. Sem ele, cada etapa usa o nível de raciocínio escolhido no `/model`.
- Opcionais: `provider` e `id` (nome do modelo virtual, padrão `phase/router`), `name`, `contextWindow` e `maxTokens` (só aparecem antes da primeira resposta).
- Modelos locais (Ollama, LM Studio) entram como qualquer provedor declarado no `models.json` do Pi.

Se o arquivo faltar ou tiver erro, a extensão não registra nada e avisa ao abrir a sessão.

## Limitações

1. **A e D valem para uma requisição só.** Se a primeira resposta chamar uma ferramenta, a continuação já vai para B. Cada troca de modelo perde o cache de prompt daquela requisição.
2. **Compactação automática no meio de uma tarefa.** Com modelo virtual, o Pi escolhe o modelo *antes* de decidir se compacta. A extensão prevê a compactação com a mesma regra do Pi (tokens estimados acima de `contextWindow − reserveTokens` do modelo D) e já manda essa requisição para D. Se a previsão errar, por exemplo quando D tem janela de contexto maior que B, D responde a requisição seguinte em vez desta. A compactação manual (`/compact`), a que acontece no fim de uma tarefa e a de estouro de contexto não dependem dessa previsão.
3. **C atende toda requisição "direta"**, isto é, feita fora do laço do agente com o modelo virtual: o resumo da compactação, o resumo de ramo do `/tree` e extensões que chamam o modelo selecionado.
4. **Trocar para `phase/router` no meio de uma sessão já começada** não usa A: a sessão segue em B.
5. **Não combine com outra extensão que gera o resumo da compactação** (como a `@pinet/model-aware-compaction`) nem com outro roteador: o resumo dela substitui o de C.

## Sobre a sugestão do ChatGPT

Conferido no npm e no código-fonte do Pi em 18/11/2026:

- `@yeliu84/pi-model-router` (0.5.5) e `@pinet/model-aware-compaction` (0.2.27) **existem**. O primeiro escolhe o modelo por complexidade da tarefa e orçamento, não por etapa. O segundo troca só o modelo do resumo da compactação. Nenhum dos dois faz as quatro etapas.
- Os eventos `session_start`, `tool_call`, `session_before_compact`, `session_compact` e `turn_end` e a função `pi.setModel()` **existem**. Mas `setModel()` grava uma troca de modelo no histórico a cada chamada e não escolhe o modelo do resumo. O modelo virtual faz o mesmo de forma nativa: decide a cada requisição e guarda o estado no ramo da sessão (sobrevive à compactação, a `/fork` e a `/tree`).

## Testes

```bash
npm test                                   # lógica de roteamento, sem rede
node e2e/run-ollama.mjs <cli.js do Pi>     # ponta a ponta com o Ollama local (qwen3:8b e gemma3:4b)
```

O teste ponta a ponta cria um diretório de agente temporário e não toca no `~/.pi`. Resultado em 18/11/2026: A → B (ferramenta) → B → C (resumo no `gemma3:4b`) → D → B, com o fallback de A pulando um modelo inexistente. A previsão de compactação automática da limitação 2 está coberta só pelos testes unitários.
