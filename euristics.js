module.exports = {
  message: {
    modification: [
      trim,
      removeDoubleLines,
      addLinesInTheEnd
    ],
    filter: [
      remove10Digits()
    ]
  },
  topic: {
    modification: [
      trim,
      addLinesInTheEnd
    ],
    filter: []
  }
}


function trim(message){ 
  return message.trim()
};

function removeDoubleLines(message) {
  return message.replace(/\n\n/g,'\n')
}

function addLinesInTheEnd(message){
  return message + '\n\n';
}

function remove10Digits(){
  const re = /^\d{10}$/;
  return message => {
    return !re.test(message.trim());
  }

}
