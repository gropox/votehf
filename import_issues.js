const golos = require("golos-js");
const global = require("basescript");
const fetch = require("node-fetch");

global.initApp("votehf");
const CONFIG = global.CONFIG;

const log = global.getLogger("import_issues");

if (CONFIG.websocket) {
    log.info("set websocket to", CONFIG.websocket);
    golos.config.set("websocket", CONFIG.websocket);
}

if (CONFIG.chainid) {
    log.info("set chainid to", CONFIG.chainid);
    golos.config.set("chain_id", CONFIG.chainid);
}

async function getIssuesPage(page) {
    const URL = "https://api.github.com/repos/GolosChain/golos/issues?labels=hardfork,softfork&state=all&per_page=100&page=" + page;

    const body = await fetch(URL).then(function (response) {
        return response.text();
    });
    return JSON.parse(body);
}


async function getIssues() {
    let issues = [];

    for (let i = 1; i < 100; i++) {
        log.info("read page", i);
        const next = await getIssuesPage(i);

        if (!next.length) {
            break;
        }
        issues = issues.concat(next);
    }
    issues.sort((a, b) => {
        const ad = Date.parse(a.created_at);
        const bd = Date.parse(b.created_at);
        return ad - bd;
    })
    log.info("issues read", issues.length)
    return issues;
}

const CLOSED = "[CLOSED]";
const RECLOSED = "^\\[CLOSED\\]";

async function closeIssue(issue, content) {
    if (content.author && !content.title.match(RECLOSED)) {
        log.info("close issue ", issue.number, issue.title);
        await closeIssuePost(issue);
    } else {
        log.debug("closed isse, nothing to do", issue.number, issue.title);
    }
}

function getBody(issue) {
    return `
${issue.body}



[Ссылка на github](${issue.html_url})
`;
}

async function closeIssuePost(issue) {

    log.info("post comment");
    log.info("permlink", getPermlink(issue));
    log.info("title", issue.title);

    let json = {
        tags: ["vote", "hf"],
        image: [],
        links: [],
        users: [],
        app: "votehf",
        format: "markdown"
    };

    const comment = [
        "comment",
        {
            parent_author: "",
            parent_permlink: "golos",
            author: CONFIG.account,
            permlink: getPermlink(issue),
            title: CLOSED + " " + issue.title,
            body: getBody(issue),
            json_metadata: JSON.stringify(json)
        }
    ]

    await commit([comment]);
}

async function createIssuePost(issue) {

    log.info("post comment");
    log.info("permlink", getPermlink(issue));
    log.info("title", issue.title);

    let json = {
        tags: ["vote", "hf"],
        image: [],
        links: [],
        users: [],
        app: "votehf",
        format: "markdown"
    };

    const comment = [
        "comment",
        {
            parent_author: "",
            parent_permlink: "golos",
            author: CONFIG.account,
            permlink: getPermlink(issue),
            title: issue.title,
            body: getBody(issue),
            json_metadata: JSON.stringify(json)
        }
    ]

    const comment_options = [
        "comment_options",
        {
            author: CONFIG.account,
            permlink: getPermlink(issue),
            max_accepted_payout: "0.000 GBG",
            percent_steem_dollars: 10000,
            allow_votes: true,
            allow_curation_rewards: false,
            extensions: []
        }
    ];

    await commit([comment, comment_options]);
}

async function reopenIssuePost(issue) {

    log.info("post comment");
    log.info("permlink", getPermlink(issue));
    log.info("title", issue.title);

    let json = {
        tags: ["vote", "hf"],
        image: [],
        links: [],
        users: [],
        app: "votehf",
        format: "markdown"
    };

    const comment = [
        "comment",
        {
            parent_author: "",
            parent_permlink: "golos",
            author: CONFIG.account,
            permlink: getPermlink(issue),
            title: issue.title,
            body: getBody(issue),
            json_metadata: JSON.stringify(json)
        }
    ]

    await commit([comment]);
}

async function openIssue(issue, content) {
    if (content.author) {
        log.info("issue already exists", issue.number, issue.title);
        if (content.title.match(RECLOSED)) {
            log.info("closed issue, reopen ", issue.number, issue.title);
            await reopenIssuePost(issue);
        }
    } else {
        log.info("open issue", issue.number, issue.title);
        await createIssuePost(issue);
        return true;
    }
    return false;
}

function getPermlink(issue) {
    return "issue-" + issue.number;
}

async function run() {

    const LONG_IDLE = (1000 * 60 * 10);
    const SHORT_IDLE = (1000 * 60 * 5);
    while (true) {
        let idle = LONG_IDLE;
        try {
            const issueList = await getIssues();

            for (let i of issueList) {
                console.log(i.number, i.created_at, i.state, i.title)
                const content = await golos.api.getContentAsync(CONFIG.account, getPermlink(i), 0);
                switch (i.state) {
                    case "closed":
                        await closeIssue(i, content);
                        break;
                    case "open":
                        if (await openIssue(i, content)) {
                            idle = SHORT_IDLE;
                        }
                        break;
                }
                if(idle == SHORT_IDLE) {
                    break;
                }
            }
        } catch (e) {
            log.error("error in main loop");
            try {
                log.error(JSON.parse(e));
            } catch(err) {
                log.error(e);
            }
        }
        log.info("sleep", idle / 1000 / 60, "minutes");
        await global.sleep(idle);
    }
}


async function commit(ops) {

    const trxid = await send(
        {
            extensions: [],
            operations: ops
        },
        { "posting": CONFIG.key }
    );

    log.info("send transaction", trxid);
    return;
}

async function _prepareTransaction(tx) {

    const properties = await golos.api.getDynamicGlobalPropertiesAsync();
    const chainDate = new Date(properties.time + 'Z');
    const refBlockNum = properties.head_block_number - 3 & 0xFFFF;

    const block = await golos.api.getBlockAsync(properties.head_block_number - 2);
    const headBlockId = block.previous;
    return Object.assign({
        ref_block_num: refBlockNum,
        ref_block_prefix: new Buffer(headBlockId, 'hex').readUInt32LE(4),
        expiration: new Date(chainDate.getTime() + 60 * 1000)
    }, tx);
};

async function send(tx, privKeys) {
    var transaction = await _prepareTransaction(tx);
    log.debug('Signing transaction (transaction, transaction.operations)', transaction, transaction.operations);
    const signedTransaction = golos.auth.signTransaction(transaction, privKeys);
    log.debug('Broadcasting transaction (transaction, transaction.operations)', transaction, transaction.operations);
    if (global.broadcast) {
        const ret = await golos.api.broadcastTransactionSynchronousAsync(signedTransaction);
        log.debug("sent transaction, ret =", ret);
        return ret.id;
    } else {
        log.info("broadcast не включен, транзакция не отправлена", tx);
    }
};



run();