const common = require('./common.js')

window.console = {
    log: function (msg) {
        document.getElementById('output').innerText += msg + '\n'
    }
}

async function main() {
    await common.test(window, {
        opened: true
    });

    setTimeout(() => {
        window.close();
    }, 2000);
}

main();
