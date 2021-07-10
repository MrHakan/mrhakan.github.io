document.body.style.backgroundColor = white;

function nightMode() {
    if (document.body.style.backgroundColor != "black") {
        document.body.style.backgroundColor = "black";
    } else {
        alert("You are already on night mode!");
    }
}

function lightMode() {
    if (document.body.style.backgroundColor != "white") {
        document.body.style.backgroundColor = "white";
    } else {
        alert("You are already on light mode!");
    }
}