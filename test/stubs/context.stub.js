module.exports = function () {
  return {
    constructors: {
      Dsl: function () {
        return {
          register: () => Promise.resolve({id: 'filterId'}),
          test: () => {}
        };
      }
    }
  };
};
